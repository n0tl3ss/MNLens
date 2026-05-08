import { homedir } from "node:os";
import { delimiter } from "node:path";

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
