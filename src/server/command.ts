import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { assertGithubRateLimitAvailable, noteGithubRateLimit } from "./githubRateLimit.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export class CommandError extends Error {
  constructor(
    message: string,
    public readonly result: CommandResult
  ) {
    super(message);
  }
}

export function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    timeoutMs?: number;
    redact?: string[];
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  } = {}
): Promise<CommandResult> {
  return runCommandAttempt(command, args, options, 0);
}

function runCommandAttempt(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    timeoutMs?: number;
    redact?: string[];
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  },
  attempt: number
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const isGithubCommand = isGithubCliCommand(command);
    if (isGithubCommand) assertGithubRateLimitAvailable();
    const resolvedCommand = resolveExecutable(command, { ...process.env, ...options.env });
    const child = spawn(resolvedCommand, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const stdoutPipe = child.stdout;
    const stderrPipe = child.stderr;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          killTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          }, 3000);
          settled = true;
          reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : undefined;

    stdoutPipe?.setEncoding("utf8");
    stderrPipe?.setEncoding("utf8");
    stdoutPipe?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      options.onStdout?.(redact(text, options.redact));
    });
    stderrPipe?.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      options.onStderr?.(redact(text, options.redact));
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      settled = true;
      if (shouldRetrySpawn(error, attempt)) {
        setTimeout(() => {
          runCommandAttempt(command, args, options, attempt + 1).then(resolve, reject);
        }, retryDelayMs(attempt));
        return;
      }
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      const result = {
        stdout: redact(stdout, options.redact),
        stderr: redact(stderr, options.redact),
        exitCode
      };
      if (exitCode === 0) {
        resolve(result);
      } else {
        if (isGithubCommand && noteGithubRateLimit(`${result.stderr}\n${result.stdout}`)) {
          try {
            assertGithubRateLimitAvailable();
          } catch (error) {
            reject(error);
            return;
          }
        }
        reject(new CommandError(`${command} exited with code ${exitCode}`, result));
      }
    });

    if (options.input && child.stdin) {
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EPIPE" || error.code === "EBADF") return;
        child.emit("error", error);
      });
      child.stdin.end(options.input);
    }
  });
}

function isGithubCliCommand(command: string): boolean {
  return command.split(/[\\/]/).pop() === "gh";
}

function shouldRetrySpawn(error: Error, attempt: number): boolean {
  return attempt < 2 && (error as NodeJS.ErrnoException).code === "EBADF";
}

function retryDelayMs(attempt: number): number {
  return 150 * (attempt + 1);
}

function redact(value: string, secrets: string[] = []): string {
  return secrets.reduce((text, secret) => {
    if (!secret) return text;
    return text.split(secret).join("[redacted]");
  }, value);
}

function resolveExecutable(command: string, env: NodeJS.ProcessEnv): string {
  if (command.includes("/") || command.includes("\\") || isAbsolute(command)) return command;
  const pathExt = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of pathExt) {
      const candidate = join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}
