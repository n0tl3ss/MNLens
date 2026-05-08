import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { EditorKind, OpenEditorResponse, PrRef } from "../shared/types.js";
import { ensureVerificationWorktree } from "./verification.js";

type LaunchCandidate = {
  command: string;
  args: string[];
  mode?: "wait" | "detach";
};

export async function openPrInEditor(pr: PrRef, editor: EditorKind): Promise<OpenEditorResponse> {
  const repoDir = await ensureVerificationWorktree(pr);
  const command = await launchEditor(editor, repoDir);
  return { editor, repoDir, command };
}

async function launchEditor(editor: EditorKind, repoDir: string): Promise<string> {
  const candidates = editorCandidates(editor, repoDir);
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      await runLaunchCommand(candidate.command, candidate.args, candidate.mode);
      return [candidate.command, ...candidate.args].join(" ");
    } catch (error) {
      failures.push(`${[candidate.command, ...candidate.args].join(" ")}\n${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not open ${editor === "vscode" ? "VS Code" : "IntelliJ"}.\n\n${failures.join("\n\n")}`);
}

function editorCandidates(editor: EditorKind, repoDir: string): LaunchCandidate[] {
  if (editor === "vscode") {
    return process.platform === "darwin"
      ? [
          { command: "code", args: ["--reuse-window", repoDir] },
          { command: "open", args: ["-a", "Visual Studio Code", repoDir] }
        ]
      : [{ command: "code", args: ["--reuse-window", repoDir] }];
  }
  if (process.platform !== "darwin") return [{ command: "idea", args: [repoDir] }];
  return [
    ...macIntellijExecutableCandidates(repoDir),
    { command: "idea", args: [repoDir] },
    { command: "open", args: ["-b", "com.jetbrains.intellij", repoDir] },
    { command: "open", args: ["-a", "/Applications/IntelliJ IDEA.app", repoDir] },
    { command: "open", args: ["-a", "IntelliJ IDEA", repoDir] },
    { command: "open", args: ["-a", "IntelliJ IDEA CE", repoDir] }
  ];
}

function macIntellijExecutableCandidates(repoDir: string): LaunchCandidate[] {
  return [
    "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
    "/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea",
    "/Applications/IntelliJ IDEA Ultimate.app/Contents/MacOS/idea"
  ]
    .filter((path) => existsSync(path))
    .map((path) => ({ command: path, args: [repoDir], mode: "detach" }));
}

function runLaunchCommand(command: string, args: string[], mode: "wait" | "detach" = "wait"): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, mode === "detach" ? { detached: true, stdio: "ignore" } : { stdio: ["ignore", "pipe", "pipe"] });
    if (mode === "detach") {
      child.on("error", reject);
      child.on("spawn", () => {
        child.unref();
        resolve();
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    childStdout?.setEncoding("utf8");
    childStderr?.setEncoding("utf8");
    childStdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    childStderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error([`exited with code ${code}`, stderr.trim(), stdout.trim()].filter(Boolean).join("\n")));
    });
  });
}
