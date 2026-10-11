import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./command.js";
import { cacheDir } from "./paths.js";

/**
 * GitHub host configuration.
 *
 * MNLens talks to github.com by default. Set MNLENS_GITHUB_HOST (for example
 * `github.example.com`) to review PRs on a GitHub Enterprise Server instance;
 * `gh` picks the host up through GH_HOST and MNLens builds web URLs from it.
 */
export function githubHost(): string {
  const host = (process.env.MNLENS_GITHUB_HOST ?? "github.com").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return host || "github.com";
}

export function githubWebUrl(path = ""): string {
  const normalized = path.replace(/^\/+/, "");
  return `https://${githubHost()}${normalized ? `/${normalized}` : ""}`;
}

/**
 * Environment for *agent* runs (Codex / Claude Code).
 *
 * The reviewer's GitHub token is deliberately NOT forwarded: the fix pipeline
 * runs agents with full filesystem/shell access inside a disposable worktree,
 * and forwarding a write-capable token would let the agent push, comment or
 * submit reviews on its own — bypassing the human approval gates MNLens is
 * built around. MNLens performs every push/comment/review itself.
 *
 * If you want agents to be able to read GitHub (e.g. `gh pr view` during the
 * research pass), set MNLENS_AGENT_GITHUB_TOKEN to a separate fine-grained
 * token with read-only permissions. Inherited GH_TOKEN/GITHUB_TOKEN values
 * from the parent shell are stripped as well (see `agentOmitEnv`).
 */
export function agentGithubEnv(): NodeJS.ProcessEnv {
  const readOnly = process.env.MNLENS_AGENT_GITHUB_TOKEN?.trim();
  return readOnly ? { GH_TOKEN: readOnly, GH_HOST: githubHost() } : { GH_HOST: githubHost() };
}

/** Variables removed from the inherited environment before spawning an agent. */
export const agentOmitEnv = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];

// ---------------------------------------------------------------------------
// Git authentication for MNLens's own network operations
// ---------------------------------------------------------------------------


const askpassPath = join(cacheDir, process.platform === "win32" ? "git-askpass.cmd" : "git-askpass.sh");

/**
 * Returns env that lets `git fetch/push` authenticate with the reviewer token
 * without relying on (or writing to) any credential helper. GitHub accepts a
 * PAT as the password for any username, so the same answer serves both prompts.
 */
export function gitAuthEnv(token: string): NodeJS.ProcessEnv {
  if (!existsSync(askpassPath)) {
    mkdirSync(cacheDir, { recursive: true });
    if (process.platform === "win32") {
      writeFileSync(askpassPath, "@echo off\r\necho %MNLENS_GIT_TOKEN%\r\n");
    } else {
      writeFileSync(askpassPath, '#!/bin/sh\nprintf "%s\\n" "$MNLENS_GIT_TOKEN"\n');
      chmodSync(askpassPath, 0o700);
    }
  }
  return { GIT_ASKPASS: askpassPath, MNLENS_GIT_TOKEN: token, GIT_TERMINAL_PROMPT: "0" };
}

/** Env for MNLens's own gh/git calls: gh token + host, plus askpass-based git auth. */
export function githubCliEnv(token: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { GH_TOKEN: token, GH_HOST: githubHost(), ...gitAuthEnv(token), ...extra };
}

/**
 * Makes a checkout unable to authenticate on its own: clears credential helpers
 * (including ones `gh repo clone` or the user's global config added) so an agent
 * running inside it cannot fetch private data or push with the reviewer's
 * identity. MNLens's own git calls keep working through {@link gitAuthEnv}.
 */
export async function hardenWorktreeCredentials(repoDir: string): Promise<void> {
  await runCommand("git", ["config", "--local", "--replace-all", "credential.helper", ""], { cwd: repoDir, timeoutMs: 15_000 }).catch(() => undefined);
  await runCommand("git", ["config", "--local", "core.askPass", ""], { cwd: repoDir, timeoutMs: 15_000 }).catch(() => undefined);
}
