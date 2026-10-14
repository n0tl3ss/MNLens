import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyVerificationOutcome, findJavaHome, javaMajorVersion, requiredJavaVersion } from "../src/server/verificationEnvironment.js";

const gradleJdkFailure = `FAILURE: Build failed with an exception.

* What went wrong:
Could not resolve all artifacts for configuration 'classpath'.
> Could not resolve io.micronaut.build.internal:micronaut-gradle-plugins:8.1.4.
   > Dependency requires at least JVM runtime version 25. This build uses a Java 21 JVM.

* Try:
> Run this build using a Java 25 or newer JVM.
BUILD FAILED in 261ms`;

describe("verification outcome", () => {
  it("tells a run that never started from a run that found a problem", () => {
    expect(classifyVerificationOutcome(0, "ok", "")).toEqual({ outcome: "passed" });
    expect(classifyVerificationOutcome(1, "", gradleJdkFailure)).toEqual({ outcome: "blocked", blockedReason: "the build needs JDK 25 and ran on JDK 21" });
    expect(classifyVerificationOutcome(1, "", "Could not resolve all dependencies for configuration ':core:testRuntimeClasspath'.\n> Could not GET 'https://repo.example/x.pom'").outcome).toBe("blocked");
    expect(classifyVerificationOutcome(1, "TimedLifecycleSpec > records once FAILED\n    Condition not satisfied\n3 tests completed, 1 failed", "").outcome).toBe("test-failed");
    // Testcontainers without Docker: the tests ran and failed, but for a reason that is not the PR's.
    const noDocker = "ConsulReRegistrationSpec > the service de-registers FAILED\n  java.lang.IllegalStateException: Previous attempts to find a Docker environment failed. Will not retry.\n" + "x\n".repeat(5000) + "6 tests completed, 5 failed\nBUILD FAILED in 38s";
    expect(classifyVerificationOutcome(1, noDocker, "")).toEqual({ outcome: "blocked", blockedReason: "the tests need Docker, which is not running on this machine" });
    expect(classifyVerificationOutcome(1, "something else went wrong", "").outcome).toBe("test-failed");
    expect(classifyVerificationOutcome(127, "", "zsh: command not found: ./mvnw")).toMatchObject({ outcome: "blocked" });
    expect(classifyVerificationOutcome(1, "$ gh pr checkout 13888 --detach\n", "fatal: couldn't find remote ref refs/heads/fix/codec-exception-write-error\nfailed to run git: exit status 128")).toMatchObject({ outcome: "blocked", blockedReason: "the PR could not be checked out for the run" });
    expect(classifyVerificationOutcome(1, "", "* What went wrong:\nProject 'micronaut-micrometer-core' not found in root project 'micrometer-parent'.")).toMatchObject({ outcome: "blocked", blockedReason: expect.stringContaining("micronaut-micrometer-core") });
  });

  it("reads the JDK a build asks for and the version of an installed JDK", () => {
    expect(requiredJavaVersion(gradleJdkFailure)).toBe(25);
    expect(requiredJavaVersion("Run this build using a Java 21 or newer JVM.")).toBe(21);
    expect(requiredJavaVersion("tests failed")).toBeUndefined();
    expect(javaMajorVersion('JAVA_VERSION="25"\nJAVA_VERSION_DATE="2025-09-16"')).toBe(25);
    expect(javaMajorVersion('IMPLEMENTOR="Oracle"\nJAVA_VERSION="21.0.7"')).toBe(21);
    expect(javaMajorVersion('JAVA_VERSION="1.8.0_392"')).toBe(8);
    expect(javaMajorVersion("nothing")).toBeUndefined();
  });
});

describe("JDK discovery", () => {
  const previous = process.env.JAVA_HOME;
  afterEach(() => {
    if (previous === undefined) delete process.env.JAVA_HOME;
    else process.env.JAVA_HOME = previous;
  });

  it("accepts JAVA_HOME when it is new enough and ignores it otherwise", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mnlens-jdk-"));
    await mkdir(join(dir, "bin"), { recursive: true });
    await writeFile(join(dir, "bin", "java"), "");
    await writeFile(join(dir, "release"), 'JAVA_VERSION="40"\n');
    process.env.JAVA_HOME = dir;
    expect(await findJavaHome(40)).toEqual({ home: dir, version: 40 });
    expect(await findJavaHome(41)).toBeUndefined();
    await rm(dir, { recursive: true, force: true });
  });
});
