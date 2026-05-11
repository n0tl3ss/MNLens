import { MessageSquare, Send, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ExistingReviewComment, PrDetail, ReviewComment, ReviewInsight } from "../../../shared/types";
import type { DraftReviewComment } from "./CommentTab";
import { CodeFindBar, HighlightedCode, countMatches, matchingLineIndex } from "./CodeFind";
import { InsightQuestionBox } from "./InsightSection";
import { AuthorLink, Badge } from "./uiBits";
import "./diffViewer.css";

type PlanFileSignal = {
  kind: "risk" | "focus" | "evidence" | "test";
  title: string;
  body: string;
  recommendation?: string;
  severity?: ReviewInsight["severity"];
  tone: "danger" | "queue" | "feature" | "added";
};

export type OverviewLinePin = {
  target: Omit<ReviewComment, "body">;
  kind: PlanFileSignal["kind"];
  title: string;
  body: string;
  recommendation?: string;
  severity?: ReviewInsight["severity"];
  tone: PlanFileSignal["tone"];
  draftBody: string;
};

export function extractFileDiff(diff: string, path: string): string {
  const lines = stripPatchPreamble(diff).split("\n");
  const chunks: string[][] = [];
  let current: string[] = [];
  let matches = false;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current.length > 0 && matches) chunks.push(current);
      current = [line];
      matches = line.includes(` a/${path} `) || line.includes(` b/${path}`);
      continue;
    }
    if (current.length > 0) current.push(line);
  }
  if (current.length > 0 && matches) chunks.push(current);
  if (chunks.length === 0) return stripPatchPreamble(diff);
  return chunks[chunks.length - 1].join("\n");
}

export function stripPatchPreamble(diff: string): string {
  const lines = diff.split("\n");
  const firstDiff = lines.findIndex((line) => line.startsWith("diff --git "));
  return (firstDiff >= 0 ? lines.slice(firstDiff) : lines).join("\n");
}

export function DiffViewer({
  diff,
  detail,
  comments,
  existingComments,
  overviewPins = [],
  onAddComment,
  onUpdateComment,
  onDeleteComment
}: {
  diff: string;
  detail?: PrDetail;
  comments: DraftReviewComment[];
  existingComments: ExistingReviewComment[];
  overviewPins?: OverviewLinePin[];
  onAddComment: (comment: ReviewComment) => void;
  onUpdateComment: (id: string, body: string) => void;
  onDeleteComment: (id: string) => void;
}) {
  const maxLines = 1600;
  const lines = diff.split("\n");
  const visibleLines = lines.slice(0, maxLines);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineMatchCounts = useMemo(() => visibleLines.map((line) => countMatches(line, query)), [visibleLines, query]);
  const totalMatches = lineMatchCounts.reduce((sum, count) => sum + count, 0);
  const activeLineIndex = query.trim() ? matchingLineIndex(lineMatchCounts, activeMatch) : -1;
  const truncated = lines.length > maxLines;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let currentPath = "";
  let oldPath = "";

  useEffect(() => {
    if (!findOpen) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [findOpen]);

  useEffect(() => {
    if (activeMatch >= totalMatches) setActiveMatch(0);
  }, [activeMatch, totalMatches]);

  useEffect(() => {
    if (activeLineIndex < 0) return;
    containerRef.current?.querySelector(".code-find-active")?.scrollIntoView({ block: "center" });
  }, [activeLineIndex, activeMatch]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFindOpen(true);
    }
    if (event.key === "Escape" && findOpen) {
      setFindOpen(false);
      setQuery("");
    }
  }

  function nextMatch(delta: 1 | -1) {
    if (totalMatches === 0) return;
    setActiveMatch((current) => (current + delta + totalMatches) % totalMatches);
  }

  return (
    <div className="diff-viewer" ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown} role="table" aria-label="Pull request patch">
      {findOpen && (
        <CodeFindBar
          query={query}
          total={totalMatches}
          active={activeMatch}
          inputRef={inputRef}
          onQueryChange={(value) => {
            setQuery(value);
            setActiveMatch(0);
          }}
          onNext={() => nextMatch(1)}
          onPrevious={() => nextMatch(-1)}
          onClose={() => {
            setFindOpen(false);
            setQuery("");
          }}
        />
      )}
      {visibleLines.map((line, index) => {
        const kind = diffLineKind(line);
        let fileHeader: string | undefined;
        if (line.startsWith("diff --git ")) {
          currentPath = "";
          oldPath = "";
        }
        if (line.startsWith("--- ")) {
          oldPath = normalizeDiffPath(line.slice(4));
        }
        if (line.startsWith("+++ ")) {
          currentPath = normalizeDiffPath(line.slice(4)) || oldPath;
          fileHeader = currentPath;
        }
        if (line.startsWith("@@")) {
          inHunk = true;
          const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
          oldLine = match ? Number(match[1]) : oldLine;
          newLine = match ? Number(match[2]) : newLine;
        }
        if (kind === "meta") inHunk = false;
        const displayKind = inHunk || kind === "hunk" ? kind : "meta";
        if (displayKind === "meta") {
          return fileHeader ? (
            <div className="diff-file-header" key={`${index}-${line}`}>
              {fileHeader}
            </div>
          ) : null;
        }
        const oldNumber = displayKind === "add" || displayKind === "hunk" ? "" : String(oldLine++);
        const newNumber = displayKind === "remove" || displayKind === "hunk" ? "" : String(newLine++);
        const commentTarget = buildCommentTarget(currentPath, displayKind, oldNumber, newNumber);
        const comment = commentTarget ? comments.find((item) => item.path === commentTarget.path && item.line === commentTarget.line && item.side === commentTarget.side) : undefined;
        const existingForLine = commentTarget
          ? existingComments.filter((item) => {
              const line = item.line ?? item.originalLine;
              return item.path === commentTarget.path && line === commentTarget.line && (item.side ?? commentTarget.side) === commentTarget.side;
            })
          : [];
        const pinsForLine = commentTarget
          ? overviewPins.filter((pin) => pin.target.path === commentTarget.path && pin.target.line === commentTarget.line && pin.target.side === commentTarget.side)
          : [];
        return (
          <div className={`diff-row ${comment || existingForLine.length > 0 || pinsForLine.length > 0 ? "has-comment" : ""} ${index === activeLineIndex ? "code-find-active" : ""}`} key={`${index}-${line}`}>
            {fileHeader && <div className="diff-file-header">{fileHeader}</div>}
            <div className={`diff-line ${displayKind}`} role="row">
              <span className="line-no old" role="cell">
                {oldNumber}
              </span>
              <span className="line-no next" role="cell">
                {newNumber}
              </span>
              <code role="cell">
                <HighlightedCode text={line || " "} query={query} />
              </code>
              <span className="comment-cell">
                {commentTarget && !comment && (
                  <button className="comment-button" title="Add review comment" onClick={() => onAddComment({ ...commentTarget, body: "" })}>
                    <MessageSquare size={14} />
                  </button>
                )}
              </span>
            </div>
            {comment && (
              <div className="inline-comment">
                <textarea value={comment.body} placeholder={`Comment on ${comment.path}:${comment.line}`} onChange={(event) => onUpdateComment(comment.id, event.target.value)} />
                <button className="icon-button danger" title="Remove comment" onClick={() => onDeleteComment(comment.id)}>
                  <X size={16} />
                </button>
              </div>
            )}
            {existingForLine.map((existing) => (
              <div className="existing-inline-comment" key={existing.id}>
                <div>
                  <AuthorLink name={existing.author} url={existing.authorUrl} />
                  <span>{relativeDate(existing.createdAt)}</span>
                  <a href={existing.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  {commentTarget && !comment && (
                    <button className="text-button" onClick={() => onAddComment({ ...commentTarget, body: replyDraft(existing.body) })}>
                      <Send size={13} />
                      Draft reply
                    </button>
                  )}
                </div>
                <MarkdownBody body={existing.body} />
                {detail && commentTarget && (
                  <InsightQuestionBox
                    detail={detail}
                    insight={existingReviewCommentInsight(existing, commentTarget)}
                    tone="focus"
                    sourceLabel={`Diff / Comment / ${existing.path}:${commentTarget.line}`}
                    onDraftComment={(body, target) => {
                      if (target) onAddComment({ ...target, body });
                    }}
                    draftCommentLabel="Draft line comment"
                  />
                )}
              </div>
            ))}
            {pinsForLine.map((pin) => (
              <div className={`overview-line-pin ${pin.tone}`} key={`${pin.kind}-${pin.title}-${pin.target.line}`}>
                <div>
                  <Badge tone={pin.tone}>{pin.kind}</Badge>
                  {pin.severity && <Badge tone={toneForSeverity(pin.severity)}>{pin.severity}</Badge>}
                  <strong>{pin.title}</strong>
                </div>
                <p>{pin.body}</p>
                {pin.recommendation && <em>{pin.recommendation}</em>}
                {!comment && (
                  <button onClick={() => onAddComment({ ...pin.target, body: pin.draftBody })}>
                    <MessageSquare size={14} />
                    Draft author comment
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {truncated && <div className="diff-truncated">Diff truncated after {maxLines} lines for browser performance.</div>}
    </div>
  );
}

function normalizeDiffPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") return "";
  return trimmed.replace(/^a\//, "").replace(/^b\//, "");
}

function buildCommentTarget(
  path: string,
  kind: "add" | "remove" | "hunk" | "meta" | "context",
  oldNumber: string,
  newNumber: string
): Omit<ReviewComment, "body"> | undefined {
  if (!path || kind === "hunk" || kind === "meta") return undefined;
  if (newNumber) return { path, line: Number(newNumber), side: "RIGHT" };
  if (oldNumber) return { path, line: Number(oldNumber), side: "LEFT" };
  return undefined;
}

function diffLineKind(line: string): "add" | "remove" | "hunk" | "meta" | "context" {
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("From ") ||
    line.startsWith("From: ") ||
    line.startsWith("Date: ") ||
    line.startsWith("Subject: ") ||
    line.startsWith("Co-Authored-By: ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("create mode ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    /^\s+\d+ files? changed/.test(line) ||
    /^\s+\d+ file changed/.test(line)
  ) {
    return "meta";
  }
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}

function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}

function relativeDate(value: string): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (!Number.isFinite(minutes)) return value;
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 48 * 60) return "yesterday";
  return date.toLocaleDateString();
}

function replyDraft(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return `Replying to this review comment:\n\n> ${compact.slice(0, 500)}\n\n`;
}

function existingReviewCommentInsight(
  comment: ExistingReviewComment,
  target: Omit<ReviewComment, "body">
): Partial<ReviewInsight> & { observation: string } {
  return {
    title: `Line comment: ${target.path}:${target.line}`,
    observation: comment.body,
    perspective: `GitHub review comment by ${comment.author} on ${target.path}:${target.line}.`,
    recommendation: "Use Codex to explain the comment, draft a reply, or prepare a focused review comment for this line.",
    severity: comment.isResolved === true ? "info" : commentSeverity(comment.body)
  };
}

function commentSeverity(body: string): ReviewInsight["severity"] {
  const text = body.toLowerCase();
  if (/\b(bug|broken|incorrect|fail|failing|regression|security|unsafe|must|block|leak)\b/.test(text)) return "high";
  if (/\b(can this|should|please|remove|add|missing|test|why|verify|use)\b/.test(text)) return "medium";
  return "low";
}

function toneForSeverity(severity?: string): string {
  if (severity === "high") return "danger";
  if (severity === "medium") return "queue";
  if (severity === "low") return "improvement";
  return "neutral";
}
