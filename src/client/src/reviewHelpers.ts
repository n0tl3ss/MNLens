import type { AnalysisResult, FixJob, Job, PrDetail, PrListItem, ReviewInsight } from "../../shared/types";
import type { ReviewScore } from "./reviewScoring";

export type PrSortField = "date" | "name" | "score";
export type SortDirection = "asc" | "desc";

export type PrRepositoryGroup = {
  repository: string;
  items: PrListItem[];
  unanalyzed: number;
};

export type PrTriage = {
  label: string;
  tone: string;
  nextAction: string;
  reason: string;
  priority: number;
};

export function groupPrsByRepository(prs: PrListItem[], latestJobForKey: (key: string) => Job | undefined): PrRepositoryGroup[] {
  const groups = new Map<string, PrListItem[]>();
  for (const pr of prs) {
    groups.set(pr.repository, [...(groups.get(pr.repository) ?? []), pr]);
  }
  return [...groups.entries()].map(([repository, items]) => ({
    repository,
    items,
    unanalyzed: items.filter((pr) => !hasAnalysisSignal(pr, latestJobForKey(pr.key))).length
  }));
}

export function comparePrs(
  a: PrListItem,
  b: PrListItem,
  field: PrSortField,
  direction: SortDirection,
  latestJobForKey: (key: string) => Job | undefined,
  scoreForPr: (pr: PrListItem) => ReviewScore
): number {
  const multiplier = direction === "asc" ? 1 : -1;
  let value = 0;
  if (field === "name") {
    value = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  } else if (field === "score") {
    value = scoreForPr(a).score - scoreForPr(b).score;
  } else {
    value = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  }
  if (value !== 0) return value * multiplier;
  const triageA = triageForPr(a, latestJobForKey(a.key));
  const triageB = triageForPr(b, latestJobForKey(b.key));
  return triageB.priority - triageA.priority || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.title.localeCompare(b.title);
}

export function sameSidebarScore(a: ReviewScore, b: ReviewScore): boolean {
  return a.score === b.score && a.label === b.label && a.tone === b.tone && a.effort.label === b.effort.label && a.effort.minutes === b.effort.minutes;
}

export function sortFieldLabel(field: PrSortField): string {
  if (field === "name") return "name";
  if (field === "score") return "score";
  return "date";
}

export function sortDirectionLabel(field: PrSortField, direction: SortDirection): string {
  if (field === "name") return direction === "asc" ? "A to Z" : "Z to A";
  if (field === "score") return direction === "asc" ? "Low to high" : "High to low";
  return direction === "asc" ? "Oldest first" : "Newest first";
}

export function prioritizeAnalysisBatch(prs: PrListItem[], latestJobForKey: (key: string) => Job | undefined): PrListItem[] {
  return [...prs].sort((a, b) => {
    const aHasAnalysis = hasAnalysisSignal(a, latestJobForKey(a.key));
    const bHasAnalysis = hasAnalysisSignal(b, latestJobForKey(b.key));
    if (aHasAnalysis !== bHasAnalysis) return aHasAnalysis ? 1 : -1;
    const aRunning = isAnalysisInFlight(latestJobForKey(a.key));
    const bRunning = isAnalysisInFlight(latestJobForKey(b.key));
    if (aRunning !== bRunning) return aRunning ? 1 : -1;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

export function hasAnalysisSignal(pr: PrListItem, job?: Job): boolean {
  return Boolean(pr.aiType || pr.analysisStatus === "done" || job?.status === "done" || job?.result || job?.fast);
}

export function isAnalysisInFlight(job?: Job): boolean {
  return job?.status === "queued" || job?.status === "running";
}

export function insightScope(item: Partial<ReviewInsight>): "source" | "test-maintainability" {
  const text = `${item.title ?? ""} ${item.observation ?? ""} ${item.perspective ?? ""} ${item.recommendation ?? ""}`.toLowerCase();
  const testOnly =
    text.includes("test") &&
    (text.includes("logger") ||
      text.includes("mock") ||
      text.includes("fixture") ||
      text.includes("flaky") ||
      text.includes("cleanup") ||
      text.includes("mutation") ||
      text.includes("maintainability") ||
      text.includes("isolation"));
  return testOnly ? "test-maintainability" : "source";
}

export function insightScopeLabel(item: Partial<ReviewInsight>): string {
  return insightScope(item) === "test-maintainability" ? "test maintainability" : "source risk";
}

export function triageForPr(pr: PrListItem, job?: Job, fixJobs: FixJob[] = []): PrTriage {
  if (job?.status === "queued" || job?.status === "running") {
    return {
      label: job.mode === "fast" ? "fast scoring" : "analyzing",
      tone: "queue",
      nextAction: "Wait for analysis to finish",
      reason: job.mode === "fast" ? "MNLens is estimating score from lightweight PR metadata." : "Codex is currently generating review guidance.",
      priority: 70
    };
  }
  if (job?.status === "failed") {
    return { label: "analysis failed", tone: "danger", nextAction: "Reanalyze or inspect manually", reason: job.error ?? "The latest analysis job failed.", priority: 95 };
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    if (latestPushedFix(fixJobs)) {
      return {
        label: "fix pushed",
        tone: "queue",
        nextAction: "Review pushed fixes",
        reason: "GitHub still shows changes requested, but this app has a pushed fix session. Review the latest state instead of treating it as blocked.",
        priority: 78
      };
    }
    return { label: "author action", tone: "danger", nextAction: "Check author update", reason: "GitHub shows changes were requested. Look for new commits or replies before spending review time.", priority: 100 };
  }
  if (pr.mergeStateStatus && /dirty|behind/i.test(pr.mergeStateStatus)) {
    return { label: "blocked", tone: "danger", nextAction: "Update branch", reason: `Merge state is ${pr.mergeStateStatus}. Update the branch or resolve conflicts first.`, priority: 92 };
  }
  if ((pr.branchBehindBy ?? 0) > 0) {
    return { label: "branch behind", tone: "queue", nextAction: "Update branch", reason: `The target branch has ${pr.branchBehindBy} newer commit${pr.branchBehindBy === 1 ? "" : "s"} not in this PR branch.`, priority: 82 };
  }
  if (pr.reviewDecision === "APPROVED") {
    return { label: "approved", tone: "added", nextAction: "Monitor merge readiness", reason: "GitHub already records an approval.", priority: 15 };
  }
  if (pr.analysisMode === "fast" || job?.fast) {
    return { label: "fast scored", tone: "improvement", nextAction: "Deep Analyze if this looks important", reason: "Score is estimated from lightweight metadata; open the PR for full review guidance.", priority: 60 };
  }
  if (!pr.aiType && !job?.result) {
    return { label: "needs score", tone: "neutral", nextAction: "Fast Analyze visible", reason: "No cached fast score or deep review plan exists yet.", priority: 65 };
  }
  if ((pr.aiRiskCount ?? 0) >= 4 || (pr.changedFiles ?? 0) >= 15) {
    return { label: "deep review", tone: "queue", nextAction: "Start with risks and changed files", reason: `${pr.aiRiskCount ?? 0} risks, ${pr.changedFiles ?? 0} files changed.`, priority: 85 };
  }
  if ((pr.aiTestsCount ?? 0) > 0 && (pr.aiType === "feature" || pr.aiType === "bug")) {
    return { label: "verify", tone: "queue", nextAction: "Run suggested checks", reason: `${plural(pr.aiTestsCount ?? 0, "test/check")} suggested by analysis.`, priority: 75 };
  }
  if (isLikelyDocsOnlyListItem(pr)) {
    return { label: "quick pass", tone: "added", nextAction: "Review docs wording", reason: "This looks like a small docs-only change.", priority: 40 };
  }
  return { label: "review", tone: "improvement", nextAction: "Open overview", reason: "No blocker is visible from the queue-level data.", priority: 55 };
}

export function latestPushedFix(fixJobs: FixJob[]): FixJob | undefined {
  return fixJobs
    .filter((job) => job.status === "done" && job.pushed)
    .sort((a, b) => Date.parse(b.pushedAt ?? b.updatedAt) - Date.parse(a.pushedAt ?? a.updatedAt))[0];
}

export function isSimplePr(detail: PrDetail, analysis?: AnalysisResult): boolean {
  const changedLines = sourceChangedLines(detail);
  const riskCount = analysis?.risks.length ?? 0;
  return changedLines <= 80 && (riskCount <= 2 || isDocsOnlyReview(undefined, detail, analysis));
}

export function sourceChangedLines(detail: PrDetail): number {
  return detail.files
    .filter((file) => !isDocsPath(file.path) && !isTestPath(file.path))
    .reduce((sum, file) => sum + file.additions + file.deletions, 0);
}

export function isDocsOnlyReview(pr?: PrListItem, detail?: PrDetail, analysis?: AnalysisResult): boolean {
  const type = analysis?.type ?? pr?.aiType;
  if (type === "docs") return true;
  if (!detail?.files.length) return false;
  return detail.files.every((file) => isDocsPath(file.path));
}

export function isLikelyDocsOnlyListItem(pr: PrListItem): boolean {
  return pr.aiType === "docs" || /\b(doc|docs|documentation|readme|guide)\b/i.test(`${pr.title} ${pr.labels.join(" ")}`);
}

export function isTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.endsWith("test.java") ||
    lower.endsWith("test.kt") ||
    lower.endsWith("spec.groovy") ||
    lower.endsWith(".spec.ts") ||
    lower.endsWith(".test.ts") ||
    lower.endsWith(".spec.tsx") ||
    lower.endsWith(".test.tsx")
  );
}

export function isDocsPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.startsWith("docs/") ||
    lower.startsWith("src/main/docs/") ||
    lower.endsWith(".adoc") ||
    lower.endsWith(".md") ||
    lower.endsWith(".rst") ||
    lower.endsWith(".txt")
  );
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
