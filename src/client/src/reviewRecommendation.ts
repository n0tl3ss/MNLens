import type { AnalysisResult, CiCheck, FixJob, PrDetail, ReviewInsight, ReviewProgress, VerificationJob } from "../../shared/types";
import type { DraftReviewComment } from "./components/CommentTab";
import type { RecommendationContext } from "./components/DetailTab";
import type { ReviewRecommendation } from "./components/OverviewSections";
import { fixCurrentSpecialist } from "./fixHelpers";
import { insightScope, isDocsOnlyReview, latestPushedFix, sourceChangedLines } from "./reviewHelpers";
import { reviewScoreForPr } from "./reviewScoring";
import { effectiveCriterionStatus } from "../../shared/acceptance";
import {
  ciSummary,
  commandKey,
  extractRunnableCommand,
  isAutomationVerificationCandidate,
  isGenuineManualVerification,
  manualCheckId,
  usableCheckTime
} from "./verificationHelpers";

export function finalReviewRecommendation(
  pr: PrDetail,
  context: RecommendationContext = {}
): ReviewRecommendation {
  const analysis = context.analysis;
  const ci = ciSummary(context.ciChecks ?? []);
  const fixJobs = context.fixJobs ?? [];
  const latestVerification = latestVerificationJobs(context.verificationJobs ?? []);
  const latestFix = [...fixJobs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const runningFix = fixJobs.find((job) => job.status === "queued" || job.status === "running");
  const pushedFix = latestPushedFix(fixJobs);
  const staleFailingCiAfterFix = Boolean(pushedFix && ci.label === "failing" && latestFailingCiAt(context.ciChecks ?? []) < Date.parse(pushedFix.pushedAt ?? pushedFix.updatedAt));
  const manualChecks = context.progress?.manualChecks ?? {};
  const manualStatuses = Object.values(manualChecks);
  const manualFailed = manualStatuses.filter((item) => item.status === "failed");
  const manualPending = analysis
    ? analysis.testsToCheck.filter((item, index) => isGenuineManualVerification(item) && !manualChecks[manualCheckId(item, index)]).length
    : 0;
  const requiredVerificationItems = analysis?.testsToCheck.filter((item) => extractRunnableCommand(item) || isGenuineManualVerification(item)).length ?? 0;
  const automationPending = analysis?.testsToCheck.filter((item) => isAutomationVerificationCandidate(item)).length ?? 0;
  const draftCount = (context.draftComments ?? []).filter((comment) => comment.body.trim()).length;
  const score = reviewScoreForPr(pr, {
    detail: pr,
    analysis,
    progress: context.progress,
    ciChecks: context.ciChecks,
    verificationJobs: context.verificationJobs,
    fixJobs,
    draftComments: context.draftComments,
    canApproveWithoutComments: context.canApproveWithoutComments
  });
  const docsOnly = isDocsOnlyReview(pr, pr, analysis);
  const sourceLines = sourceChangedLines(pr);
  const checkedItems = new Set(context.progress?.checkedItems ?? []);
  const highSourceInsights = [...(analysis?.riskDetails ?? []), ...(analysis?.reviewerFocusDetails ?? [])].filter(
    (item) => item.severity === "high" && insightScope(item) === "source"
  );
  const uncheckedHighSource = highSourceInsights.filter((item, index) => !checkedItems.has(insightProgressId("Risks", itemWithObservation(item), index)));
  const sourceBlockingInsights = highSourceInsights.filter((item) =>
    /do not approve|would not approve|missing|required|must|leak|silent failure|security|vulnerab/i.test(
      `${item.title} ${item.observation} ${item.perspective ?? ""} ${item.recommendation ?? ""}`
    )
  );
  const weakSourceTests = !docsOnly && sourceLines > 0 && (analysis?.testAssessment?.rating === "weak" || analysis?.testAssessment?.rating === "partial");
  const localFailed = latestVerification.filter((job) => job.status === "failed" || (typeof job.exitCode === "number" && job.exitCode !== 0));
  const evidence: ReviewRecommendation["evidence"] = [];
  const blockers: string[] = [];

  const addEvidence = (title: string, body: string, tone: string) => evidence.push({ title, body, tone });
  addEvidence("Score", `${score.score}/100, ${score.label}, expected ${score.effort.label} review effort.`, score.tone);
  addEvidence("CI", ci.label === "failing" && staleFailingCiAfterFix ? "CI failure appears older than the latest pushed fix; refresh or rerun before deciding." : `Current CI is ${ci.label}.`, ci.tone);
  if (analysis?.testAssessment) {
    addEvidence("Tests", `${analysis.testAssessment.rating}: ${analysis.testAssessment.summary}`, toneForTestRating(analysis.testAssessment.rating));
  }
  if (highSourceInsights.length > 0) {
    addEvidence("Source risks", `${highSourceInsights.length} high-severity source review point${highSourceInsights.length === 1 ? "" : "s"} found.`, uncheckedHighSource.length > 0 ? "queue" : "danger");
  }
  if (pushedFix) {
    addEvidence("Fix pushed", `A Codex fix was pushed ${relativeDate(pushedFix.pushedAt ?? pushedFix.updatedAt)}. Review the updated diff instead of relying on older review state.`, "added");
  } else if (latestFix?.diff?.trim()) {
    addEvidence("Fix preview", "There are prepared Codex changes that have not been pushed.", "queue");
  }

  if (runningFix) blockers.push(`Agent fix is still ${runningFix.status}: ${fixCurrentSpecialist(runningFix)}.`);
  const criteria = context.acceptance?.criteria ?? [];
  const criteriaFailed = criteria.filter((criterion) => effectiveCriterionStatus(criterion, context.verificationJobs ?? []) === "failed");
  const criteriaUnproven = criteria.filter((criterion) => effectiveCriterionStatus(criterion, context.verificationJobs ?? []) === "unproven");
  if (criteriaFailed.length > 0) blockers.push(`${criteriaFailed.length} acceptance ${criteriaFailed.length === 1 ? "criterion" : "criteria"} failed: ${criteriaFailed[0].text}`);
  if (ci.label === "failing" && !staleFailingCiAfterFix) blockers.push("CI is currently failing and should be explained or fixed.");
  if (localFailed.length > 0) blockers.push(`${plural(localFailed.length, "local verification")} failed.`);
  if (manualFailed.length > 0) blockers.push(`${plural(manualFailed.length, "manual check")} marked as failed.`);
  if (sourceBlockingInsights.length > 0) blockers.push(`${plural(sourceBlockingInsights.length, "high source issue")} look actionable.`);
  if (weakSourceTests) blockers.push(`Test quality is ${analysis?.testAssessment?.rating}; source behavior is not proven enough yet.`);
  if (draftCount > 0 && !context.canApproveWithoutComments) blockers.push(`${plural(draftCount, "draft review comment")} still need to be submitted.`);

  const holdReasons: string[] = [];
  if (criteriaUnproven.length > 0) holdReasons.push(`${criteriaUnproven.length} acceptance ${criteriaUnproven.length === 1 ? "criterion" : "criteria"} unproven: ${criteriaUnproven.map((criterion) => criterion.text).slice(0, 2).join("; ")}.`);
  if (!analysis) holdReasons.push("No AI analysis is available yet.");
  if (ci.label === "running") holdReasons.push("CI is still running.");
  if (staleFailingCiAfterFix) holdReasons.push("CI should be refreshed after the pushed fix.");
  if (manualPending > 0 && !docsOnly) holdReasons.push(`${plural(manualPending, "manual verification")} not recorded.`);
  if (automationPending > 0 && weakSourceTests && blockers.length === 0) holdReasons.push(`${plural(automationPending, "test item")} should be converted into automated coverage instead of manual review work.`);
  if (requiredVerificationItems > 0 && latestVerification.length === 0 && manualStatuses.length === 0 && !docsOnly) holdReasons.push("No runnable or genuinely manual verification has been recorded.");
  if (uncheckedHighSource.length > 0 && blockers.length === 0) holdReasons.push(`${plural(uncheckedHighSource.length, "high source review point")} still unchecked.`);
  if (latestFix?.diff?.trim() && !latestFix.pushed) holdReasons.push("Prepared Codex changes need human inspection before push or final review.");

  let decision: ReviewRecommendation["decision"] = "hold";
  let tone = "queue";
  let label = "Hold review";
  let summary = holdReasons[0] ?? "Finish the remaining review signals before submitting a final GitHub review.";

  if (blockers.length > 0) {
    decision = "request-changes";
    tone = "danger";
    label = "Request changes";
    summary = "The current evidence points to actionable work before this PR should be approved.";
  } else if (holdReasons.length > 0) {
    decision = "hold";
    tone = "queue";
    label = "Hold";
    summary = holdReasons[0];
  } else if (context.canApproveWithoutComments || score.score >= 85 || pr.reviewDecision === "APPROVED") {
    decision = "approve";
    tone = "added";
    label = "Approve";
    summary = docsOnly
      ? "This looks ready after a quick wording/rendering pass."
      : "No blocker is visible, and the review evidence is strong enough for approval after your final diff skim.";
  } else {
    decision = "hold";
    tone = "improvement";
    label = "Continue review";
    summary = "No hard blocker is visible, but the plan is not complete enough to recommend approval yet.";
  }

  const confidence = recommendationConfidence(analysis, ci.label, evidence.length, blockers.length, holdReasons.length, latestVerification.length);
  const visibleBlockers = decision === "hold" ? holdReasons : blockers;
  return {
    decision,
    label,
    tone,
    confidence,
    summary,
    blockers: visibleBlockers,
    evidence: evidence.slice(0, 5),
    score,
    draftBody: buildRecommendationDraft(decision, summary, visibleBlockers, evidence)
  };
}


export function latestVerificationJobs(jobs: VerificationJob[]): VerificationJob[] {
  const latest = new Map<string, VerificationJob>();
  for (const job of [...jobs].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    latest.set(commandKey(job.command), job);
  }
  return [...latest.values()];
}


function toneForTestRating(rating?: string): string {
  if (rating === "strong" || rating === "good") return "added";
  if (rating === "partial") return "queue";
  if (rating === "weak") return "danger";
  return "neutral";
}

function insightProgressId(section: string, item: Partial<ReviewInsight> & { observation: string }, index: number): string {
  const source = `${section}:${item.title ?? ""}:${item.observation}:${index}`;
  let hash = 0;
  for (const char of source) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `insight:${section.toLowerCase().replace(/\s+/g, "-")}:${hash.toString(16)}`;
}

function itemWithObservation(item: Partial<ReviewInsight>): Partial<ReviewInsight> & { observation: string } {
  return { ...item, observation: item.observation ?? item.title ?? "Review point" };
}

function recommendationConfidence(
  analysis: AnalysisResult | undefined,
  ciLabel: string,
  evidenceCount: number,
  blockerCount: number,
  holdCount: number,
  verificationCount: number
): ReviewRecommendation["confidence"] {
  let points = 0;
  if (analysis) points += 2;
  if (ciLabel === "passing" || ciLabel === "failing") points += 2;
  if (verificationCount > 0) points += 1;
  if (evidenceCount >= 3) points += 1;
  if (blockerCount > 0) points += 1;
  if (holdCount > 1) points -= 1;
  return points >= 5 ? "high" : points >= 3 ? "medium" : "low";
}

function buildRecommendationDraft(
  decision: ReviewRecommendation["decision"],
  summary: string,
  blockers: string[],
  evidence: ReviewRecommendation["evidence"]
): string {
  const header = decision === "approve" ? "I think this is ready to approve." : decision === "request-changes" ? "I would request changes before approval." : "I would hold final review for now.";
  const lines = [header, "", summary];
  if (blockers.length > 0) {
    lines.push("", "Main items:");
    for (const blocker of blockers.slice(0, 5)) lines.push(`- ${blocker}`);
  }
  if (evidence.length > 0) {
    lines.push("", "Evidence:");
    for (const item of evidence.slice(0, 4)) lines.push(`- ${item.title}: ${item.body}`);
  }
  return lines.join("\n");
}

/** What the latest Deep Analyze run changed versus the previous one, so the next reviewer knows what the author already addressed. */


function latestFailingCiAt(checks: CiCheck[]): number {
  const times = checks
    .filter((check) => check.bucket === "fail" || /fail|error|cancel/i.test(check.state))
    .map((check) => Date.parse(usableCheckTime(check)))
    .filter((value) => Number.isFinite(value));
  return times.length > 0 ? Math.max(...times) : Number.NaN;
}

function relativeDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round((date.getTime() - Date.now()) / 86_400_000),
    "day"
  );
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
