import { statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentId } from "../shared/types.js";

/**
 * Deep Analyze reading pass: which files did the agent actually open?
 *
 * The reading pass runs without an output schema so its turns go into
 * reading the checkout, and MNLens recovers the file list from two sources:
 * the streamed transcript (Claude Code's NDJSON tool calls: Read, Grep, Bash)
 * and the "FILES READ:" list the prompt asks the agent to end with (the only
 * source for Codex, whose progress output has no stable tool-call format).
 * Only paths that exist as files inside the checkout count, so a hallucinated
 * or mistyped entry never reaches `inspectedFiles`.
 */

const filesReadMarker = /^[ \t]*(?:#+[ \t]*)?(?:\*\*)?FILES READ:?(?:\*\*)?[ \t]*:?[ \t]*$/im;

/**
 * Candidate paths from a streamed Claude transcript (NDJSON); Codex transcripts
 * yield none. A tool call whose result came back as an error (a denied Bash
 * command, a missing file) read nothing and is skipped.
 */
export function filesReadFromTranscript(agent: AgentId, stdout: string): string[] {
  if (agent !== "claude") return [];
  const calls: Array<{ id: string; candidates: string[] }> = [];
  const failed = new Set<string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: { type?: string; message?: { content?: unknown } };
    try {
      event = JSON.parse(trimmed) as typeof event;
    } catch {
      continue;
    }
    if (!Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content as Array<Record<string, unknown>>) {
      if (event.type === "assistant" && block.type === "tool_use") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const name = String(block.name ?? "");
        const candidates: string[] = [];
        if (name === "Read" && typeof input.file_path === "string") candidates.push(input.file_path);
        else if (name === "Grep" && typeof input.path === "string") candidates.push(input.path);
        else if (name === "Bash" && typeof input.command === "string") candidates.push(...pathTokens(input.command));
        if (candidates.length > 0) calls.push({ id: String(block.id ?? ""), candidates });
      } else if (event.type === "user" && block.type === "tool_result" && isErrorResult(block)) {
        failed.add(String(block.tool_use_id ?? ""));
      }
    }
  }
  return calls.filter((call) => !call.id || !failed.has(call.id)).flatMap((call) => call.candidates);
}

function isErrorResult(block: Record<string, unknown>): boolean {
  if (block.is_error === true) return true;
  const text = Array.isArray(block.content) ? (block.content as Array<Record<string, unknown>>).map((part) => String(part.text ?? "")).join("\n") : String(block.content ?? "");
  return /<tool_use_error>|permission denied|requires approval|was blocked|not allowed/i.test(text.slice(0, 400));
}

/** The paths listed after the final "FILES READ:" marker of the agent's notes. */
export function parseFilesReadList(text: string): string[] {
  const index = lastMarkerIndex(text);
  if (index < 0) return [];
  const tail = text.slice(index).split("\n").slice(1);
  const paths: string[] = [];
  for (const raw of tail) {
    const line = raw.trim();
    if (!line) continue;
    const cleaned = line
      .replace(/^(?:[-*+•]|\d+[.)])\s*/, "")
      .replace(/^`+|`+$/g, "")
      .trim();
    if (!cleaned) continue;
    // "path (why)" or "path - why": keep the path.
    const token = cleaned.split(/\s+[-–—(]\s*|\s+\(|\s{2,}|\s+-\s+/)[0]?.replace(/^`+|`+[:,.]?$/g, "").replace(/[:,.]+$/, "") ?? "";
    if (token && /[\w.\-/]/.test(token)) paths.push(token);
  }
  return paths;
}

/** The notes without their trailing "FILES READ:" list; MNLens keeps the list structured instead. */
export function stripFilesReadList(text: string): string {
  const index = lastMarkerIndex(text);
  return (index < 0 ? text : text.slice(0, index)).trimEnd();
}

/**
 * Keep the candidates that are files inside the checkout, as unique
 * repository-relative paths in first-seen order.
 */
export function resolveReadPaths(candidates: string[], repoDir: string): string[] {
  const root = resolve(repoDir);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const cleaned = candidate.trim().replace(/^\.\//, "");
    if (!cleaned) continue;
    const absolute = isAbsolute(cleaned) ? resolve(cleaned) : resolve(root, cleaned);
    if (absolute !== root && !absolute.startsWith(root + sep)) continue;
    const rel = relative(root, absolute).split(sep).join("/");
    if (!rel || rel === ".git" || rel.startsWith(".git/") || seen.has(rel)) continue;
    try {
      if (!statSync(absolute).isFile()) continue;
    } catch {
      continue;
    }
    seen.add(rel);
    result.push(rel);
  }
  return result;
}

/** Tokens of a shell command that look like paths (also the `path` part of `HEAD:path` and `path:line`). */
function pathTokens(command: string): string[] {
  const tokens: string[] = [];
  for (const raw of command.split(/[\s'"`;|&()<>]+/)) {
    if (!raw || raw.startsWith("-")) continue;
    const colon = raw.lastIndexOf(":");
    if (colon > 0 && colon < raw.length - 1) {
      // `git show HEAD:path`, `path:line`
      for (const part of [raw.slice(0, colon), raw.slice(colon + 1)]) if (/[/.]/.test(part)) tokens.push(part);
    } else if (/[/.]/.test(raw)) {
      tokens.push(raw);
    }
  }
  return tokens;
}

function lastMarkerIndex(text: string): number {
  let last = -1;
  const pattern = new RegExp(filesReadMarker.source, "gim");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) last = match.index;
  return last;
}
