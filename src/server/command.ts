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
    /** Environment variables to remove from the inherited environment before spawning. */
    omitEnv?: string[];
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  } = {}
): Promise<CommandResult> {
  return runCommandAttempt(command, args, options, 0);
}

export function mergeEnv(env: NodeJS.ProcessEnv | undefined, omit: string[] = []): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const key of omit) {
    if (!(env && key in env)) delete merged[key];
  }
  return merged;
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
    omitEnv?: string[];
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  },
  attempt: number
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const isGithubCommand = isGithubCliCommand(command);
    if (isGithubCommand) assertGithubRateLimitAvailable();
    const env = mergeEnv(options.env, options.omitEnv);
    const resolvedCommand = resolveExecutable(command, env);
    const child = spawn(resolvedCommand, args, {
      cwd: options.cwd,
      env,
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
        if (isGithubCommand && shouldRetryGithubExit(result, attempt)) {
          setTimeout(() => {
            runCommandAttempt(command, args, options, attempt + 1).then(resolve, reject);
          }, retryDelayMs(attempt));
          return;
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

function shouldRetryGithubExit(result: CommandResult, attempt: number): boolean {
  if (attempt >= 2) return false;
  const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (output.includes("api rate limit exceeded")) return false;
  if (output.includes("needs the \"repo\" scope")) return false;
  if (output.includes("bad credentials") || output.includes("requires authentication")) return false;
  return [
    "operation timed out",
    "connection timed out",
    "i/o timeout",
    "tls handshake timeout",
    "connection reset by peer",
    "connection refused",
    "temporary failure",
    "no such host",
    "could not resolve host",
    "server misbehaving",
    "unexpected eof",
    "stream error"
  ].some((needle) => output.includes(needle));
}

function retryDelayMs(attempt: number): number {
  return attempt === 0 ? 500 : 1500;
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

/**
 * Append terminal output to a log buffer the way a terminal would render it:
 * a bare carriage return rewinds to the start of the current line, so git's
 * "Receiving objects: 42%" progress updates replace each other instead of
 * piling up as hundreds of lines.
 */
export function appendTerminalOutput(buffer: string, chunk: string): string {
  // A trailing "\r" in the buffer means "the next text replaces the current line" (the
  // cursor moved home but nothing was written yet), so progress stays visible between chunks.
  let pendingRewind = buffer.endsWith("\r");
  let out = pendingRewind ? buffer.slice(0, -1) : buffer;
  for (const piece of chunk.split(/(\r\n|\r|\n)/)) {
    if (piece === "") continue;
    if (piece === "\r\n" || piece === "\n") {
      out += "\n";
      pendingRewind = false;
    } else if (piece === "\r") {
      pendingRewind = true;
    } else {
      if (pendingRewind) out = out.slice(0, out.lastIndexOf("\n") + 1);
      out += piece;
      pendingRewind = false;
    }
  }
  return pendingRewind ? `${out}\r` : out;
}

/** "600000ms" is not a number a human reads under pressure; "10 min" is. */
export function formatTimeout(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const minutes = ms / 60_000;
  return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1)} min`;
}

/** Starts a timer that calls `onSilent(elapsedMs)` while a command produces no output; call `touch()` on every chunk. */
export function silenceHeartbeat(onSilent: (elapsedMs: number) => void, intervalMs = 30_000): { touch: () => void; stop: () => void } {
  const startedAt = Date.now();
  let lastOutputAt = startedAt;
  const timer = setInterval(() => {
    if (Date.now() - lastOutputAt >= intervalMs) onSilent(Date.now() - startedAt);
  }, intervalMs);
  return {
    touch: () => {
      lastOutputAt = Date.now();
    },
    stop: () => clearInterval(timer)
  };
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}
