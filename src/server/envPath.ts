import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

let enhanced = false;

export function enhanceCliPath(): void {
  if (enhanced) return;
  enhanced = true;
  const home = homedir();
  const current = splitPath(process.env.PATH);
  const additions = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/opt/local/bin",
    "/opt/local/sbin",
    `${home}/.local/bin`,
    `${home}/bin`,
    `${home}/.npm-global/bin`,
    `${home}/.bun/bin`,
    `${home}/.cargo/bin`,
    // Claude Code "local" install and Codex/Volta/nvm managed binaries.
    `${home}/.claude/local`,
    `${home}/.claude/local/bin`,
    `${home}/.claude/local/node_modules/.bin`,
    `${home}/.codex/bin`,
    `${home}/.volta/bin`,
    ...nodeVersionManagerBins(home),
    `${home}/.sdkman/candidates/java/current/bin`,
    `${home}/.sdkman/candidates/maven/current/bin`,
    `${home}/.sdkman/candidates/gradle/current/bin`,
    `${home}/Library/Application Support/JetBrains/Toolbox/scripts`,
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ];
  process.env.PATH = unique([...additions, ...current]).join(delimiter);
}

function nodeVersionManagerBins(home: string): string[] {
  const roots = [join(home, ".nvm", "versions", "node"), join(home, ".fnm", "node-versions"), join(home, "Library", "Application Support", "fnm", "node-versions")];
  const bins: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const versions = readdirSync(root).sort().reverse();
      for (const version of versions) {
        for (const candidate of [join(root, version, "bin"), join(root, version, "installation", "bin")]) {
          if (existsSync(candidate)) bins.push(candidate);
        }
      }
    } catch {
      // ignore unreadable managers
    }
  }
  return bins;
}

function splitPath(value: string | undefined): string[] {
  return (value ?? "")
    .split(delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
