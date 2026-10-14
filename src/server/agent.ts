import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentId, AgentTask, ModelTier } from "../shared/types.js";
import { readAgentSettings, resolveTierModel } from "./agentSettings.js";
import { runCommand, type CommandResult } from "./command.js";
import { agentGithubEnv, agentOmitEnv } from "./githubHost.js";
import { recordAgentUsage } from "./usage.js";
import { cacheDir } from "./paths.js";

/**
 * Agent abstraction.
 *
 * MNLens drives a locally installed coding-agent CLI (Codex CLI or Claude Code)
 * for analysis, Q&A, fix pipelines, conflict resolution and manual checks.
 * Every call site builds an {@link AgentInvocation} through {@link prepareAgentRun}
 * and runs it with the existing command helpers (so cancellation, streaming,
 * redaction and recovery semantics stay in one place), then hands the raw
 * stdout to {@link parseAgentOutput} to recover the final message, session id,
 * structured output and cost.
 */

export type AgentAccess = "read-only" | "full-access";

export interface AgentRunRequest {
  task: AgentTask;
  prompt: string;
  access: AgentAccess;
  cwd: string;
  /** Resume an existing agent session (Codex thread id / Claude session id). */
  sessionId?: string;
  /** Allow the agent to use web search tools. */
  webSearch?: boolean;
  /** JSON schema the final message must satisfy (deep analysis). */
  outputSchema?: Record<string, unknown>;
  /** File path where Codex should write the final message (Codex only; ignored by Claude). */
  outputLastMessagePath?: string;
  /** Explicit agent override; defaults to the configured agent. */
  agent?: AgentId;
  /** Explicit tier override; defaults to the task's configured tier. */
  tier?: ModelTier;
  /** PR this run belongs to, for the usage ledger. */
  prKey?: string;
  /** Keep the session resumable. Defaults to true for full-access runs and false otherwise. */
  persistSession?: boolean;
  extraEnv?: NodeJS.ProcessEnv;
}

export interface AgentInvocation {
  agent: AgentId;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** Inherited variables that must not reach the agent (reviewer GitHub tokens). */
  omitEnv: string[];
  input: string;
  model: string;
  effort?: string;
  tier: ModelTier;
  task: AgentTask;
  /** Human readable, e.g. "Claude (sonnet)" for status messages. */
  label: string;
}

export interface AgentOutput {
  text: string;
  sessionId?: string;
  structured?: unknown;
  costUsd?: number;
  isError?: boolean;
}

export const codexHome = join(cacheDir, "codex-home");

export function agentDisplayName(agent: AgentId): string {
  return agent === "claude" ? "Claude" : "Codex";
}

export async function currentAgent(): Promise<AgentId> {
  return (await readAgentSettings()).agent;
}

export async function prepareAgentRun(request: AgentRunRequest): Promise<AgentInvocation> {
  const settings = await readAgentSettings();
  const agent = request.agent ?? settings.agent;
  const { tier, model, effort } = resolveTierModel(settings, agent, request.task, request.tier);
  const persist = request.persistSession ?? request.access === "full-access";
  if (agent === "claude") {
    return {
      agent,
      command: "claude",
      args: claudeArgs({ ...request, model, effort, persist, maxBudgetUsd: settings.maxBudgetUsdPerRun, mcpConfig: await claudeMcpConfig(settings.claudeMcpConfig) }),
      env: { ...agentGithubEnv(), ...(request.extraEnv ?? {}), ...claudeEnv() },
      omitEnv: agentOmitEnv,
      input: request.prompt,
      model,
      effort,
      tier,
      task: request.task,
      label: `Claude (${model})`
    };
  }
  await ensureCodexHome();
  return {
    agent,
    command: "codex",
    args: codexArgs({ ...request, model, effort, persist }),
    env: { ...agentGithubEnv(), ...(request.extraEnv ?? {}), CODEX_HOME: codexHome },
    omitEnv: agentOmitEnv,
    input: request.prompt,
    model,
    effort,
    tier,
    task: request.task,
    label: `Codex (${model})`
  };
}

/** Convenience wrapper for non-streaming call sites. */
export async function runAgent(
  request: AgentRunRequest,
  options: { timeoutMs?: number; redact?: string[]; onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void } = {}
): Promise<{ invocation: AgentInvocation; result: CommandResult; output: AgentOutput }> {
  const invocation = await prepareAgentRun(request);
  const started = Date.now();
  try {
    const result = await runCommand(invocation.command, invocation.args, {
      cwd: request.cwd,
      env: invocation.env,
      omitEnv: invocation.omitEnv,
      input: invocation.input,
      timeoutMs: options.timeoutMs,
      redact: options.redact,
      onStdout: options.onStdout,
      onStderr: options.onStderr
    });
    const output = parseAgentOutput(invocation.agent, result.stdout);
    void recordUsage(invocation, request.prKey, started, output.costUsd, output.sessionId, !output.isError);
    return { invocation, result, output };
  } catch (error) {
    void recordUsage(invocation, request.prKey, started, undefined, undefined, false);
    throw error;
  }
}

export function recordUsage(invocation: AgentInvocation, prKey: string | undefined, startedAt: number, costUsd: number | undefined, sessionId: string | undefined, ok: boolean): Promise<void> {
  return recordAgentUsage({
    prKey,
    task: invocation.task,
    agent: invocation.agent,
    model: invocation.model,
    tier: invocation.tier,
    durationMs: Date.now() - startedAt,
    costUsd,
    sessionId,
    ok
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Codex CLI
// ---------------------------------------------------------------------------

function codexArgs(request: AgentRunRequest & { model: string; effort?: string; persist: boolean }): string[] {
  const modelArgs = ["-m", request.model, ...(request.effort ? ["-c", `model_reasoning_effort="${request.effort}"`] : [])];
  if (request.sessionId) {
    // `codex exec resume` keeps the original sandbox/approval policy of the thread.
    return [...modelArgs, "exec", "resume", "--skip-git-repo-check", request.sessionId, "-"];
  }
  const args = [...modelArgs];
  if (request.webSearch) args.push("--search");
  args.push("--ask-for-approval", "never", "exec", "--skip-git-repo-check", "--sandbox", request.access === "full-access" ? "danger-full-access" : "read-only");
  if (request.outputSchema && request.outputLastMessagePath) {
    args.push("--output-schema", codexSchemaPathFor(request.outputLastMessagePath), "--output-last-message", request.outputLastMessagePath);
  } else if (request.outputLastMessagePath) {
    args.push("--output-last-message", request.outputLastMessagePath);
  }
  args.push("-");
  return args;
}

/** Codex wants the schema as a file; callers that pass `outputSchema` must also write it to this path. */
export function codexSchemaPathFor(outputLastMessagePath: string): string {
  return `${outputLastMessagePath}.schema.json`;
}

export async function ensureCodexHome(): Promise<void> {
  await mkdir(join(codexHome, "sessions"), { recursive: true });
  await chmod(codexHome, 0o700).catch(() => undefined);
  for (const file of ["auth.json", "config.toml"]) {
    const source = join(homedir(), ".codex", file);
    const target = join(codexHome, file);
    if (existsSync(source)) {
      await copyFile(source, target);
      await chmod(target, 0o600).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Claude Code CLI
// ---------------------------------------------------------------------------

const claudeEditTools = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
/** Shell commands a read-only analysis may run without a prompt; everything else stays denied. */
export const claudeReadOnlyCommands = ["Bash(git log:*)", "Bash(git show:*)", "Bash(git diff:*)", "Bash(git blame:*)", "Bash(git grep:*)", "Bash(rg:*)", "Bash(grep:*)"];

/**
 * Working directory for agent runs that need no files (Q&A, second opinion, review draft):
 * an empty folder, so the agent cannot wander into the MNLens checkout or the cache
 * (which holds agent credentials) through its read tools.
 */
export async function agentScratchDir(): Promise<string> {
  const dir = join(cacheDir, "agent-scratch");
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * The reviewer's own MCP servers, handed to every Claude run. Claude Code reads
 * CLAUDE.md and skills from the checkout and `~/.claude` on its own; MCP servers
 * are the one part of a reviewer's setup that `-p` runs do not pick up without
 * an explicit `--mcp-config`, and under `dontAsk` their tools would be denied
 * unless pre-approved, so the server names are collected for `--allowedTools`.
 */
export async function claudeMcpConfig(path: string | undefined): Promise<{ path: string; servers: string[] } | undefined> {
  if (!path) return undefined;
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as { mcpServers?: Record<string, unknown> };
    const servers = Object.keys(raw.mcpServers ?? {}).filter((name) => /^[A-Za-z0-9_-]+$/.test(name));
    return { path, servers };
  } catch {
    // A missing or malformed file must not break reviews; the run simply goes without MCP.
    return undefined;
  }
}

function claudeArgs(request: AgentRunRequest & { model: string; effort?: string; persist: boolean; maxBudgetUsd?: number; mcpConfig?: { path: string; servers: string[] } }): string[] {
  // Long-running fix passes stream NDJSON so the session log shows live tool activity; one-shot
  // read-only calls use the compact `json` envelope (required for --json-schema structured output).
  const streaming = request.access === "full-access" && !request.outputSchema;
  const args = ["-p", "--output-format", streaming ? "stream-json" : "json", ...(streaming ? ["--verbose"] : []), "--model", request.model];
  if (request.effort) args.push("--effort", request.effort);
  if (request.sessionId) args.push("--resume", request.sessionId);
  const disallowed: string[] = [];
  if (request.access === "full-access") {
    // Mirrors Codex `--sandbox danger-full-access`: the fix worktree is disposable and reviewed before push.
    args.push("--permission-mode", "bypassPermissions");
  } else {
    // Read-only: deny anything that would prompt and remove edit tools from Claude's context entirely.
    // Read-only git/grep commands are pre-approved so the agent can inspect history and callers in a checkout.
    args.push("--permission-mode", "dontAsk");
    args.push("--allowedTools", [...claudeReadOnlyCommands, ...(request.mcpConfig?.servers ?? []).map((name) => `mcp__${name}`)].join(","));
    disallowed.push(...claudeEditTools);
  }
  // Nobody is watching the terminal; never wait on a permission prompt.
  args.push("--permission-prompts", "none");
  if (!request.webSearch) disallowed.push("WebSearch", "WebFetch");
  if (disallowed.length > 0) args.push("--disallowedTools", ...disallowed);
  if (!request.persist && !request.sessionId) args.push("--no-session-persistence");
  if (request.outputSchema) args.push("--json-schema", JSON.stringify(request.outputSchema));
  if (request.maxBudgetUsd) args.push("--max-budget-usd", String(request.maxBudgetUsd));
  if (request.mcpConfig) args.push("--mcp-config", request.mcpConfig.path);
  return args;
}

function claudeEnv(): NodeJS.ProcessEnv {
  // Claude Code stores credentials in the OS keychain / ~/.claude. Isolating
  // CLAUDE_CONFIG_DIR would break subscription auth, so only honour an explicit opt-in.
  return process.env.MNLENS_CLAUDE_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: process.env.MNLENS_CLAUDE_CONFIG_DIR } : {};
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

export function parseAgentOutput(agent: AgentId, stdout: string): AgentOutput {
  if (agent === "claude") return parseClaudeOutput(stdout);
  return { text: stdout.trim(), sessionId: extractCodexSessionId(stdout) };
}

interface ClaudeResultEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
}

export function parseClaudeOutput(stdout: string): AgentOutput {
  const envelope = lastClaudeResultEnvelope(stdout);
  if (!envelope) {
    return { text: stdout.trim(), sessionId: extractClaudeSessionId(stdout) };
  }
  return {
    text: typeof envelope.result === "string" ? envelope.result.trim() : "",
    sessionId: envelope.session_id,
    structured: envelope.structured_output,
    costUsd: typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : undefined,
    isError: Boolean(envelope.is_error)
  };
}

function lastClaudeResultEnvelope(stdout: string): ClaudeResultEnvelope | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  // `--output-format json` prints one object; `stream-json` prints NDJSON with a trailing result line.
  const candidates = trimmed.startsWith("{") && !trimmed.includes("\n{") ? [trimmed] : trimmed.split("\n").filter((line) => line.trim().startsWith("{"));
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(candidates[index]) as ClaudeResultEnvelope;
      if (parsed && typeof parsed === "object" && parsed.type === "result") return parsed;
    } catch {
      // Not a JSON line (tool noise, warnings); keep scanning.
    }
  }
  // Fall back to the last `{...}` block in case the CLI printed warnings before the envelope.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      const parsed = JSON.parse(trimmed.slice(first, last + 1)) as ClaudeResultEnvelope;
      if (parsed && typeof parsed === "object" && parsed.type === "result") return parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function extractCodexSessionId(output: string): string | undefined {
  const matches = [...output.matchAll(new RegExp(`session id:\\s*(${uuidPattern})`, "gi"))];
  return matches.at(-1)?.[1];
}

export function extractClaudeSessionId(output: string): string | undefined {
  const matches = [...output.matchAll(new RegExp(`"session_id"\\s*:\\s*"(${uuidPattern})"`, "gi"))];
  return matches.at(-1)?.[1];
}

/** Agent-agnostic session id recovery from an accumulated job log. */
export function extractAgentSessionId(output: string, agent?: AgentId): string | undefined {
  // Formatted Claude logs carry a plain `session id:` line (see createAgentLogFormatter), so both patterns apply to both agents.
  if (agent === "codex") return extractCodexSessionId(output);
  return extractClaudeSessionId(output) ?? extractCodexSessionId(output);
}

/**
 * Final-message text for log/UI purposes. For Claude the raw stdout is a JSON
 * envelope, so prefer the parsed `result`; for Codex stdout already is the text.
 */
export function agentFinalText(agent: AgentId, stdout: string): string {
  return parseAgentOutput(agent, stdout).text;
}

// ---------------------------------------------------------------------------
// Live log formatting
// ---------------------------------------------------------------------------

/**
 * Turns an agent's raw stdout stream into reviewer-readable log lines for the
 * session log. Codex already prints readable progress; Claude Code's
 * `stream-json` output is NDJSON, which is rendered as a compact transcript
 * (text, tool calls, tool results, final cost). A `session id:` line is emitted
 * on init so the generic session-id recovery works for both agents.
 */
export function createAgentLogFormatter(agent: AgentId): (chunk: string) => string {
  if (agent !== "claude") return (chunk) => chunk;
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    return lines.map((line) => formatClaudeStreamLine(line)).filter((line) => line.length > 0).map((line) => `${line}\n`).join("");
  };
}

export function formatClaudeStreamLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("{")) return trimmed;
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return trimmed;
  }
  const type = String(event.type ?? "");
  if (type === "system" && event.subtype === "init") {
    return [`session id: ${String(event.session_id ?? "")}`, event.model ? `model: ${String(event.model)}` : ""].filter(Boolean).join("\n");
  }
  if (type === "assistant" || type === "user") {
    const message = event.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? (message?.content as Array<Record<string, unknown>>) : [];
    return content
      .map((block) => {
        if (block.type === "text") return String(block.text ?? "").trim();
        if (block.type === "tool_use") return `→ ${String(block.name ?? "tool")} ${summarizeToolInput(block.input)}`.trim();
        if (block.type === "tool_result") {
          const text = Array.isArray(block.content)
            ? (block.content as Array<Record<string, unknown>>).map((part) => String(part.text ?? "")).join("\n")
            : String(block.content ?? "");
          const compact = text.replace(/\s+/g, " ").trim();
          return compact ? `← ${compact.slice(0, 300)}${compact.length > 300 ? "…" : ""}` : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (type === "result") {
    // The final assistant text was already streamed as an `assistant` event; only add the summary line here.
    const cost = typeof event.total_cost_usd === "number" ? ` · ~$${event.total_cost_usd.toFixed(3)}` : "";
    const turns = typeof event.num_turns === "number" ? ` · ${event.num_turns} turns` : "";
    const errorText = event.is_error && typeof event.result === "string" ? `${event.result.trim()}\n` : "";
    return `${errorText}[claude result${event.is_error ? " · error" : ""}${turns}${cost}]`;
  }
  if (type === "system" && event.subtype === "api_retry") return `[retry ${String(event.attempt)}/${String(event.max_retries)}: ${String(event.error ?? "")}]`;
  return "";
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const preferred = ["command", "file_path", "path", "pattern", "query", "url", "description"];
  for (const key of preferred) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.replace(/\s+/g, " ").trim().slice(0, 160);
  }
  return "";
}
