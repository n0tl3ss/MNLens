import type { AnalysisDelta, AnalysisDeltaItem, AnalysisDeltaKind } from "../../shared/types";

/** Overview section each delta kind links to; the id is set by InsightSection. */
export const deltaKindTone: Record<AnalysisDeltaKind, "risk" | "focus" | "assumption" | "edge"> = {
  risk: "risk",
  focus: "focus",
  assumption: "assumption",
  "edge-case": "edge"
};

export function deltaKindLabel(kind: AnalysisDeltaKind): string {
  if (kind === "risk") return "Risk";
  if (kind === "focus") return "Reviewer focus";
  if (kind === "assumption") return "Assumption";
  return "Edge case";
}

export function insightSectionId(tone: string): string {
  return `insight-section-${tone}`;
}

/** Highest severity first, source order otherwise. */
export function sortDeltaItems<T extends AnalysisDeltaItem>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => severityRank(b.item.severity) - severityRank(a.item.severity) || a.index - b.index)
    .map(({ item }) => item);
}

/** Card tone: red when a high-severity finding is new, amber for any new finding, teal when the re-run only resolved things. */
export function deltaTone(delta: AnalysisDelta): "danger" | "queue" | "added" | "neutral" {
  if (delta.added.some((item) => item.severity === "high")) return "danger";
  if (delta.added.length > 0) return "queue";
  if (delta.resolved.length > 0) return "added";
  return "neutral";
}

export function deltaSummary(delta: AnalysisDelta): string {
  const parts = [
    `${delta.resolved.length} resolved`,
    `${delta.added.length} new`,
    `${delta.persisting.length} persisting`
  ];
  const changed = delta.persisting.filter((item) => item.previousSeverity).length;
  if (changed > 0) parts[2] += ` (${changed} changed severity)`;
  if (delta.carriedVerdicts > 0) parts.push(`${delta.carriedVerdicts} verdict${delta.carriedVerdicts === 1 ? "" : "s"} carried over`);
  return parts.join(" · ");
}

function severityRank(severity: string | undefined): number {
  if (severity === "high") return 4;
  if (severity === "medium") return 3;
  if (severity === "low") return 2;
  return 1;
}
