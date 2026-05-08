import type { FixJob, Job, PrListItem } from "../../shared/types";
import {
  comparePrs,
  groupPrsByRepository,
  hasAnalysisSignal,
  prioritizeAnalysisBatch,
  type PrSortField,
  type SortDirection
} from "./reviewHelpers";
import { reviewScoreForPr, type ReviewScore } from "./reviewScoring";

interface PrQueueViewArgs {
  prs: PrListItem[];
  jobs: Record<string, Job>;
  fixJobs: Record<string, FixJob>;
  fullReviewScores: Record<string, ReviewScore>;
  typeFilter: string;
  repoFilter: string;
  sortField: PrSortField;
  sortDirection: SortDirection;
  query: string;
  collapsedRepos: Record<string, boolean>;
}

export function buildPrQueueView({
  prs,
  jobs,
  fixJobs,
  fullReviewScores,
  typeFilter,
  repoFilter,
  sortField,
  sortDirection,
  query,
  collapsedRepos
}: PrQueueViewArgs) {
  const latestJobForPr = (prKey: string): Job | undefined =>
    Object.values(jobs)
      .filter((job) => job.prKey === prKey)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  const scoreForPrList = (pr: PrListItem): { score: ReviewScore; estimated: boolean; available: boolean } => {
    const cached = fullReviewScores[pr.key];
    if (cached) return { score: cached, estimated: false, available: true };
    const rowJob = latestJobForPr(pr.key);
    const rowFixJobs = Object.values(fixJobs).filter((job) => job.prKey === pr.key);
    const scorePr = rowJob?.fast ? { ...pr, ...rowJob.fast } : pr;
    return { score: reviewScoreForPr(scorePr, { job: rowJob, fixJobs: rowFixJobs }), estimated: true, available: hasAnalysisSignal(scorePr, rowJob) };
  };

  const normalizedQuery = query.toLowerCase();
  const visiblePrs = prs
    .filter((pr) => {
      const matchesType = typeFilter === "all" || pr.aiType === typeFilter;
      const matchesRepo = repoFilter === "all" || pr.repository === repoFilter;
      const text = `${pr.title} ${pr.repository} ${pr.author} ${pr.labels.join(" ")}`.toLowerCase();
      return matchesType && matchesRepo && text.includes(normalizedQuery);
    })
    .sort((a, b) => comparePrs(a, b, sortField, sortDirection, latestJobForPr, (pr) => scoreForPrList(pr).score));
  const visiblePrGroups = groupPrsByRepository(visiblePrs, latestJobForPr);
  const expandedVisiblePrs = visiblePrs.filter((pr) => !collapsedRepos[pr.repository]);
  const visibleAnalysisBatch = prioritizeAnalysisBatch(expandedVisiblePrs, latestJobForPr);
  const unanalyzedVisibleCount = visibleAnalysisBatch.filter((pr) => !hasAnalysisSignal(pr, latestJobForPr(pr.key))).length;

  return {
    visiblePrs,
    visiblePrGroups,
    visibleAnalysisBatch,
    unanalyzedVisibleCount,
    latestJobForPr,
    scoreForPrList
  };
}
