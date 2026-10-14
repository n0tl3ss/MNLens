import type {
  AnalysisDelta,
  AnalysisDeltaItem,
  AnalysisDeltaKind,
  AnalysisDeltaPersistingItem,
  AnalysisResult,
  ReviewInsight
} from "../shared/types.js";
import { readAnalysisHistory } from "./cache.js";
import { carryOverFindingVerdicts, salientWords, verdictKey } from "./reviewMemory.js";

/**
 * Analysis-to-analysis delta.
 *
 * Reviewers of long-lived PRs re-run Deep Analyze after every push. Instead of
 * re-reading every finding they get three lists: what the new analysis no
 * longer raises (resolved), what it still raises (persisting, possibly reworded
 * or at a different severity) and what is new.
 *
 * Matching is deliberately model-free and mirrors review memory:
 *   1. `verdictKey(kind, title)` — the key a reviewer's kept/dismissed verdict
 *      is stored under, so a verdict on a persisting item still applies.
 *   2. Normalized observation text (the `patternKey` word normalization over the
 *      whole observation) for findings the agent retitled; near-identical
 *      observations count too, so a small rewording does not look like a new
 *      finding.
 * Items never match across kinds: a risk that became a reviewer-focus item is a
 * resolved risk plus a new focus item, which is also how verdict keys see it.
 */

/** Minimum word overlap (Jaccard) for two observations to be the same finding when the titles differ. */
const observationOverlapThreshold = 0.6;
const minimumSharedWords = 3;

const sections: Array<{ kind: AnalysisDeltaKind; pick: (analysis: AnalysisResult) => ReviewInsight[] | undefined }> = [
  { kind: "risk", pick: (analysis) => analysis.riskDetails },
  { kind: "focus", pick: (analysis) => analysis.reviewerFocusDetails },
  { kind: "assumption", pick: (analysis) => analysis.assumptions },
  { kind: "edge-case", pick: (analysis) => analysis.edgeCases }
];

/** The findings a delta is computed over, flattened with their review-memory kind. */
export function deltaItems(analysis: AnalysisResult): AnalysisDeltaItem[] {
  const items: AnalysisDeltaItem[] = [];
  for (const section of sections) {
    for (const insight of section.pick(analysis) ?? []) {
      const title = (insight.title ?? "").trim();
      const observation = (insight.observation ?? "").trim();
      if (!title && !observation) continue;
      items.push({
        kind: section.kind,
        title: title || observation,
        observation,
        severity: insight.severity ?? "info",
        location: insight.location?.trim() || undefined
      });
    }
  }
  return items;
}

/** Normalized observation text: every salient word, de-duplicated and sorted (patternKey keeps only the first four). */
export function observationKey(text: string): string {
  return salientWords(text).join(" ");
}

export function computeAnalysisDelta(previous: AnalysisResult, next: AnalysisResult): AnalysisDelta {
  const before = deltaItems(previous);
  const after = deltaItems(next);
  const unmatchedBefore = new Set(before.keys());
  const unmatchedAfter = new Set(after.keys());
  const matches: Array<{ beforeIndex: number; afterIndex: number; matchedBy: AnalysisDeltaPersistingItem["matchedBy"] }> = [];

  // Pass 1: same verdict key (kind + normalized title).
  const beforeByTitle = new Map<string, number[]>();
  for (const [index, item] of before.entries()) {
    const key = verdictKey(item.kind, item.title);
    beforeByTitle.set(key, [...(beforeByTitle.get(key) ?? []), index]);
  }
  for (const [afterIndex, item] of after.entries()) {
    const beforeIndex = (beforeByTitle.get(verdictKey(item.kind, item.title)) ?? []).find((candidate) => unmatchedBefore.has(candidate));
    if (beforeIndex === undefined) continue;
    matches.push({ beforeIndex, afterIndex, matchedBy: "title" });
    unmatchedBefore.delete(beforeIndex);
    unmatchedAfter.delete(afterIndex);
  }

  // Pass 2: same (or nearly the same) observation text within the same kind.
  for (const afterIndex of [...unmatchedAfter]) {
    const item = after[afterIndex];
    const words = salientWords(item.observation);
    let best: { beforeIndex: number; score: number } | undefined;
    for (const beforeIndex of unmatchedBefore) {
      const candidate = before[beforeIndex];
      if (candidate.kind !== item.kind) continue;
      const score = overlap(words, salientWords(candidate.observation));
      if (score >= observationOverlapThreshold && (!best || score > best.score)) best = { beforeIndex, score };
    }
    if (!best) continue;
    matches.push({ beforeIndex: best.beforeIndex, afterIndex, matchedBy: "observation" });
    unmatchedBefore.delete(best.beforeIndex);
    unmatchedAfter.delete(afterIndex);
  }

  const persisting: AnalysisDeltaPersistingItem[] = matches
    .sort((a, b) => a.afterIndex - b.afterIndex)
    .map(({ beforeIndex, afterIndex, matchedBy }) => {
      const current = after[afterIndex];
      const old = before[beforeIndex];
      return {
        ...current,
        matchedBy,
        previousTitle: verdictKey(old.kind, old.title) === verdictKey(current.kind, current.title) ? undefined : old.title,
        previousSeverity: old.severity === current.severity ? undefined : old.severity
      };
    });
  return {
    previousGeneratedAt: previous.generatedAt,
    previousDiffHash: previous.diffHash,
    resolved: [...unmatchedBefore].sort((a, b) => a - b).map((index) => before[index]),
    persisting,
    added: [...unmatchedAfter].sort((a, b) => a - b).map((index) => after[index]),
    carriedVerdicts: 0
  };
}

/**
 * Delta of a fresh analysis against the last analysis of a different diff:
 * the cached one when the diff changed, else (a forced re-run on the same
 * diff) the newest history entry. Reviewer verdicts on reworded persisting
 * items are copied to the new titles so nothing has to be judged twice.
 */
export async function deltaAgainstPrevious(
  detail: { owner: string; repo: string; number: number; key: string },
  cached: AnalysisResult | undefined,
  next: AnalysisResult
): Promise<AnalysisDelta | undefined> {
  const baseline = cached && cached.diffHash !== next.diffHash ? cached : (await readAnalysisHistory(detail.key).catch(() => []))[0];
  if (!baseline || baseline.diffHash === next.diffHash) return undefined;
  const delta = computeAnalysisDelta(baseline, next);
  const reworded = delta.persisting.filter((item) => item.previousTitle);
  delta.carriedVerdicts = reworded.length
    ? await carryOverFindingVerdicts(
        detail.owner,
        detail.repo,
        detail.number,
        reworded.map((item) => ({ kind: item.kind, previousTitle: item.previousTitle!, title: item.title, observation: item.observation }))
      ).catch(() => 0)
    : 0;
  return delta;
}

function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const shared = a.filter((word) => setB.has(word)).length;
  if (shared < minimumSharedWords) return 0;
  return shared / new Set([...a, ...b]).size;
}
