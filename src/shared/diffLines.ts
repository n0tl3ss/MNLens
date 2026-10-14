/**
 * Unified-diff line mapping shared by the server (prompt annotation + anchor
 * validation) and tests.
 *
 * GitHub review comments are anchored by `path`, `side` (LEFT = old file,
 * RIGHT = new file) and the line number *in that file*, not the diff offset.
 * This module walks a unified diff once and records every commentable line so
 * an agent's suggested anchors can be checked instead of trusted.
 */

export type DiffSide = "LEFT" | "RIGHT";

export interface DiffLineRef {
  path: string;
  side: DiffSide;
  line: number;
  /** "+" added, "-" removed, " " context. */
  kind: "+" | "-" | " ";
  text: string;
}

export interface AnnotatedDiff {
  /** Diff rewritten with `path R123 + code` style prefixes the agent can quote back. */
  text: string;
  /** Every commentable (path, side, line) triple in the diff. */
  anchors: Set<string>;
  /** Changed (non-context) lines per path on the RIGHT side; used to pick a fallback anchor. */
  changedLinesByPath: Map<string, number[]>;
  files: string[];
}

export function anchorKey(path: string, side: DiffSide, line: number): string {
  return `${normalizeDiffPath(path)}|${side}|${line}`;
}

export function normalizeDiffPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") return "";
  return trimmed.replace(/^a\//, "").replace(/^b\//, "");
}

/**
 * Parse a unified diff into addressable lines. Tolerates the `git format-patch`
 * headers MNLens sometimes receives and multiple files per diff.
 */
export function parseDiffLines(diff: string): DiffLineRef[] {
  const refs: DiffLineRef[] = [];
  let path = "";
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const rawLines = diff.split("\n");
  if (rawLines[rawLines.length - 1] === "") rawLines.pop();
  for (const raw of rawLines) {
    if (raw.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      path = match ? match[2] : "";
      inHunk = false;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const candidate = normalizeDiffPath(raw.slice(4));
      if (candidate) path = candidate;
      inHunk = false;
      continue;
    }
    if (raw.startsWith("--- ")) {
      inHunk = false;
      continue;
    }
    if (raw.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (!match) continue;
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || !path) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw.startsWith("+")) {
      refs.push({ path, side: "RIGHT", line: newLine, kind: "+", text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith("-")) {
      refs.push({ path, side: "LEFT", line: oldLine, kind: "-", text: raw.slice(1) });
      oldLine += 1;
    } else if (raw.startsWith(" ") || raw === "") {
      refs.push({ path, side: "RIGHT", line: newLine, kind: " ", text: raw.slice(1) });
      oldLine += 1;
      newLine += 1;
    } else {
      // Anything else (format-patch trailers, stats) ends the hunk.
      inHunk = false;
    }
  }
  return refs;
}

/**
 * Render the diff with explicit side/line prefixes so the agent can cite
 * anchors exactly as MNLens will validate them. The path appears once per
 * file (repeating it on every line more than tripled the prompt for a large
 * PR and pushed half the diff past the cap):
 *
 *   ### src/app.ts
 *   R12 + const x = 1;
 *   L10 -   old();
 *   R13     context();
 */
export function annotateDiff(diff: string, options: { maxChars?: number } = {}): AnnotatedDiff {
  const refs = parseDiffLines(diff);
  const anchors = new Set<string>();
  const changedLinesByPath = new Map<string, number[]>();
  const files: string[] = [];
  const lines: string[] = [];
  let currentPath = "";
  for (const ref of refs) {
    if (ref.path !== currentPath) {
      currentPath = ref.path;
      files.push(ref.path);
      lines.push("", `### ${ref.path}`);
    }
    anchors.add(anchorKey(ref.path, ref.side, ref.line));
    if (ref.kind === "+") {
      const list = changedLinesByPath.get(ref.path) ?? [];
      list.push(ref.line);
      changedLinesByPath.set(ref.path, list);
    }
    const prefix = ref.side === "RIGHT" ? `R${ref.line}` : `L${ref.line}`;
    lines.push(`${prefix} ${ref.kind === " " ? " " : ref.kind} ${ref.text}`);
  }
  let text = lines.join("\n").trimStart();
  const maxChars = options.maxChars ?? 70_000;
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n\n[Annotated diff truncated from ${text.length} characters; comment only on the lines shown.]`;
  return { text, anchors, changedLinesByPath, files };
}

/**
 * Validate an agent-supplied anchor. Returns the anchor to use, or `undefined`
 * (with `unanchored: true`) when the line is not part of the diff. A RIGHT-side
 * anchor that misses by a line or two snaps to the nearest changed line in the
 * same file because models frequently count from the hunk header.
 */
export function resolveAnchor(
  annotated: Pick<AnnotatedDiff, "anchors" | "changedLinesByPath">,
  candidate: { path: string; side?: string; line?: number }
): { path: string; side: DiffSide; line?: number; unanchored: boolean } {
  const path = normalizeDiffPath(candidate.path);
  const side: DiffSide = candidate.side === "LEFT" ? "LEFT" : "RIGHT";
  const line = typeof candidate.line === "number" && Number.isFinite(candidate.line) ? Math.trunc(candidate.line) : undefined;
  if (line !== undefined && annotated.anchors.has(anchorKey(path, side, line))) return { path, side, line, unanchored: false };
  if (line !== undefined && side === "RIGHT") {
    const changed = annotated.changedLinesByPath.get(path) ?? [];
    const nearest = changed.reduce<number | undefined>((best, value) => (Math.abs(value - line) <= 2 && (best === undefined || Math.abs(value - line) < Math.abs(best - line)) ? value : best), undefined);
    if (nearest !== undefined) return { path, side, line: nearest, unanchored: false };
  }
  return { path, side, line: undefined, unanchored: true };
}
