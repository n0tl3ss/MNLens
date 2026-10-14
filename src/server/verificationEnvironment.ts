import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { VerificationJob } from "../shared/types.js";
import { runCommand } from "./command.js";

/**
 * A local verification run can fail for three different reasons, and only one
 * of them says anything about the PR:
 *
 *   passed       the command ran and exited 0
 *   test-failed  the command ran and something it checked is wrong
 *   blocked      the command never got to run: wrong JDK, offline dependency
 *                resolution, missing tool
 *
 * "Proven means ran" only holds if a blocked run is reported as "could not run
 * here" instead of demoting the criterion to failed, which is what happened on
 * the first live run (the repo's Gradle plugin wanted JDK 25, the machine's
 * default was 21).
 */
export type VerificationOutcome = NonNullable<VerificationJob["outcome"]>;

const blockedPatterns: Array<{ pattern: RegExp; reason: (match: RegExpMatchArray) => string }> = [
  { pattern: /Dependency requires at least JVM runtime version (\d+)\. This build uses a Java (\d+) JVM/i, reason: (m) => `the build needs JDK ${m[1]} and ran on JDK ${m[2]}` },
  { pattern: /Run this build using a Java (\d+) or newer JVM/i, reason: (m) => `the build needs JDK ${m[1]} or newer` },
  { pattern: /Unsupported class file major version (\d+)/i, reason: () => "the JDK running the build is too old for the build tooling" },
  { pattern: /(?:JAVA_HOME is set to an invalid directory|JAVA_HOME is not set and no 'java' command|Unable to locate a Java Runtime|No Java runtime present|The JAVA_HOME environment variable is not defined correctly)/i, reason: () => "no usable Java installation was found" },
  { pattern: /Could not resolve all (?:artifacts|dependencies|files) for configuration/i, reason: () => "dependency resolution failed before any test ran" },
  { pattern: /(?:UnknownHostException|Network is unreachable|Connection refused|Could not (?:GET|HEAD|download) '|Could not connect to|ENOTFOUND|ETIMEDOUT)/i, reason: () => "the build could not reach the network" },
  { pattern: /No matching toolchains found|Cannot find a Java installation|Unable to find a Java installation|toolchain .* (?:could not be found|not found)/i, reason: () => "the Java toolchain the build asks for is not installed" },
  { pattern: /(?:Project|Task) '([^']+)' not found in (?:root )?project|Cannot locate tasks that match '([^']+)'|Project with path '([^']+)' could not be found/i, reason: (m) => `the command names a Gradle project or task that does not exist (${m[1] ?? m[2] ?? m[3]})` },
  { pattern: /couldn't find remote ref|failed to run git|fatal: (?:unable to access|could not read|repository .* not found|Authentication failed)/i, reason: () => "the PR could not be checked out for the run" },
  { pattern: /(?:command not found|No such file or directory|ENOENT)/i, reason: () => "a tool the command relies on is not installed" },
  { pattern: /Permission denied/i, reason: () => "a tool the command relies on is not executable" }
];

/**
 * Tests that fail because the machine lacks what they need (Docker for
 * Testcontainers, a database, a network service) say nothing about the PR
 * either. These are checked over the whole output, because the cause is
 * printed once near the first failing test, not at the end.
 */
const infrastructurePatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /Could not find a valid Docker environment|Previous attempts to find a Docker environment failed|Cannot connect to the Docker daemon|Is the docker daemon running|docker: command not found|DockerClientProviderStrategy/i, reason: "the tests need Docker, which is not running on this machine" },
  { pattern: /Testcontainers.*(?:timed out|could not start|Could not pull|failed to pull)|Container startup failed|ContainerLaunchException/i, reason: "a test container could not be started here" },
  { pattern: /Connection refused: (?:localhost|127\.0\.0\.1)|Could not open JDBC Connection|java\.net\.ConnectException/i, reason: "the tests need a local service that is not running here" }
];

/** Decide what a finished run says. Only the last part of the output is inspected: that is where build tools print the cause. */
export function classifyVerificationOutcome(exitCode: number | null | undefined, stdout: string, stderr: string): { outcome: VerificationOutcome; blockedReason?: string } {
  if (exitCode === 0) return { outcome: "passed" };
  const text = `${stderr.slice(-8_000)}\n${stdout.slice(-8_000)}`;
  const everything = `${stderr}\n${stdout}`;
  for (const { pattern, reason } of infrastructurePatterns) {
    if (pattern.test(everything)) return { outcome: "blocked", blockedReason: reason };
  }
  // A test report means the build got as far as running tests, so the failure is the PR's.
  if (/\d+ tests? completed, \d+ failed|Tests run: \d+, Failures: [1-9]|FAILED\s*$|AssertionError|Condition not satisfied|expected:.*but was|✗|FAIL\s+\S+\.test/m.test(text)) return { outcome: "test-failed" };
  for (const { pattern, reason } of blockedPatterns) {
    const match = text.match(pattern);
    if (match) return { outcome: "blocked", blockedReason: reason(match) };
  }
  return { outcome: "test-failed" };
}

/** The JDK major version a Gradle/Maven failure says it needs, if the failure is about that. */
export function requiredJavaVersion(output: string): number | undefined {
  const text = output.slice(-8_000);
  const match = text.match(/requires at least JVM runtime version (\d+)/i) ?? text.match(/Run this build using a Java (\d+) or newer JVM/i) ?? text.match(/requires (?:Java|JDK) (\d+)(?: or (?:newer|later|higher))?/i);
  if (!match) return undefined;
  const version = Number(match[1]);
  return Number.isFinite(version) && version >= 8 && version <= 99 ? version : undefined;
}

/** Major version from a JDK's `release` file (`JAVA_VERSION="25"` or `"21.0.7"` or `"1.8.0_392"`). */
export function javaMajorVersion(releaseFile: string): number | undefined {
  const match = releaseFile.match(/^JAVA_VERSION="?(\d+)(?:\.(\d+))?/m);
  if (!match) return undefined;
  const first = Number(match[1]);
  return first === 1 ? Number(match[2]) : first;
}

/**
 * Find an installed JDK whose major version is at least `minVersion`, preferring
 * the lowest one that satisfies it. Looks where macOS, Homebrew, SDKMAN and Linux
 * distributions put JDKs, plus JAVA_HOME; nothing is downloaded.
 */
export async function findJavaHome(minVersion: number): Promise<{ home: string; version: number } | undefined> {
  const candidates = new Set<string>();
  if (process.env.JAVA_HOME) candidates.add(process.env.JAVA_HOME);
  if (process.platform === "darwin") {
    const result = await runCommand("/usr/libexec/java_home", ["-v", `${minVersion}+`], { timeoutMs: 10_000 }).catch(() => undefined);
    const home = result?.stdout.trim();
    if (home) candidates.add(home);
    for (const root of ["/Library/Java/JavaVirtualMachines", join(homedir(), "Library/Java/JavaVirtualMachines")]) {
      for (const entry of await listDir(root)) candidates.add(join(root, entry, "Contents/Home"));
    }
  }
  for (const brew of ["/opt/homebrew/opt", "/usr/local/opt", "/home/linuxbrew/.linuxbrew/opt"]) {
    for (const entry of await listDir(brew)) {
      if (!/^(openjdk|temurin|zulu|corretto)/.test(entry)) continue;
      candidates.add(join(brew, entry, "libexec/openjdk.jdk/Contents/Home"));
      candidates.add(join(brew, entry, "libexec"));
      candidates.add(join(brew, entry));
    }
  }
  for (const root of [join(homedir(), ".sdkman/candidates/java"), join(homedir(), ".jdks"), join(homedir(), ".asdf/installs/java"), "/usr/lib/jvm", "/usr/java"]) {
    for (const entry of await listDir(root)) candidates.add(join(root, entry));
  }
  let best: { home: string; version: number } | undefined;
  for (const home of candidates) {
    const releasePath = join(home, "release");
    if (!existsSync(releasePath) || !existsSync(join(home, "bin", "java"))) continue;
    const version = javaMajorVersion(await readFile(releasePath, "utf8").catch(() => ""));
    if (version === undefined || version < minVersion) continue;
    if (!best || version < best.version) best = { home, version };
  }
  return best;
}

async function listDir(path: string): Promise<string[]> {
  return existsSync(path) ? readdir(path).catch(() => [] as string[]) : [];
}
