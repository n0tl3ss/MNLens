import type { AnalysisResult, PrDetail } from "./types.js";

/**
 * Review-context fingerprint.
 *
 * Deep Analyze is cached by `diffHash`, but review guidance also depends on
 * discussion state: new or resolved comments, new reviews, linked-issue edits
 * and base-branch changes. This hash captures that state so the UI can flag a
 * cached analysis as stale and `analyzePr` can refresh it when a reviewer
 * re-runs Deep Analyze. Volatile fields (mergeStateStatus, CI, timestamps of
 * the PR itself) are deliberately excluded to avoid churn.
 *
 * Runs in both the browser and Node, hence a tiny FNV-1a instead of crypto.
 */
export function analysisContextHash(detail: Pick<PrDetail, "diffHash" | "baseRefName" | "linkedIssues" | "conversationComments" | "reviewSummaries" | "reviewComments">): string {
  const parts = [
    `diff:${detail.diffHash}`,
    `base:${detail.baseRefName}`,
    ...(detail.linkedIssues ?? []).map((issue) => `issue:${issue.repository ?? ""}#${issue.number}:${issue.state ?? ""}:${issue.updatedAt ?? ""}`).sort(),
    ...(detail.conversationComments ?? []).map((comment) => `comment:${comment.id}`).sort(),
    ...(detail.reviewSummaries ?? []).map((review) => `review:${review.id}:${review.state}`).sort(),
    ...(detail.reviewComments ?? []).map((comment) => `line:${comment.id}:${comment.isResolved ? "resolved" : "open"}`).sort()
  ];
  return fnv1a(parts.join("\n"));
}

export type AnalysisFreshness = "fresh" | "diff-changed" | "context-changed" | "unknown";

export function analysisFreshness(analysis: Pick<AnalysisResult, "diffHash" | "contextHash"> | undefined, detail: Parameters<typeof analysisContextHash>[0] | undefined): AnalysisFreshness {
  if (!analysis || !detail) return "unknown";
  if (analysis.diffHash !== detail.diffHash) return "diff-changed";
  if (analysis.contextHash && analysis.contextHash !== analysisContextHash(detail)) return "context-changed";
  return "fresh";
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
