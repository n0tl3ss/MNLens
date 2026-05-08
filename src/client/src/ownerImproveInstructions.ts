import type { AnalysisResult, CiCheck, FixJob, PrListItem, VerificationJob } from "../../shared/types";
import type { DraftReviewComment } from "./components/CommentTab";
import type { ReviewScore } from "./reviewScoring";
import { latestVerificationJobs } from "./reviewRecommendation";
import { toneForCi } from "./verificationHelpers";

export function buildOwnerImproveInstructions(
  pr: PrListItem,
  analysis: AnalysisResult | undefined,
  score: ReviewScore | undefined,
  ciChecks: CiCheck[],
  verificationJobs: VerificationJob[],
  fixJobs: FixJob[],
  draftComments: DraftReviewComment[]
): string {
  const scoreBlockers = score?.breakdown.adjustments
    .filter((item) => item.points < 0)
    .map((item) => `- ${item.label}: ${item.reason}${item.action ? ` Action: ${item.action}` : ""}`)
    .join("\n");
  const raiseActions = score?.breakdown.raiseActions.map((item) => `- ${item}`).join("\n");
  const failingCi = ciChecks
    .filter((check) => toneForCi(check) === "danger")
    .map((check) => `- ${check.name}: ${check.state || check.description || check.bucket}${check.link ? ` (${check.link})` : ""}`)
    .join("\n");
  const failedVerification = latestVerificationJobs(verificationJobs)
    .filter((job) => job.status === "failed" || (typeof job.exitCode === "number" && job.exitCode !== 0))
    .map((job) => `- ${job.command}: ${job.error || job.statusMessage || `exit ${job.exitCode ?? "unknown"}`}`)
    .join("\n");
  const openDraftComments = draftComments
    .filter((comment) => comment.body.trim().length > 0)
    .map((comment) => `- ${comment.path}:${comment.line} ${comment.side}: ${comment.body.trim()}`)
    .join("\n");
  const latestFix = [...fixJobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  return `Owner improvement pass for ${pr.repository} #${pr.number}: ${pr.title}

Goal:
- Increase the PR readiness score by addressing concrete, actionable blockers.
- Address existing PR review comments, failing CI checks, failed local verification, missing automated tests, and high/medium analysis risks when they are fixable in code/docs/tests.
- Prefer converting manual verification into automated tests or TCK-style coverage when practical.
- Keep the patch focused and reviewable.
- Do not commit, push, submit review comments, or change PR metadata. Prepare local changes only for the human owner to inspect.
- If a finding is not actionable or cannot be safely fixed locally, leave a concise note in the fix session log instead of guessing.

Current score:
${score ? `${score.score}/100 (${score.label}); ${score.effort.label} review, ${score.effort.minutes}` : "No computed score is available yet."}

Score blockers:
${scoreBlockers || "No explicit negative score adjustments are available."}

How to raise the score:
${raiseActions || "Use the analysis, PR comments, CI, and verification data to find concrete improvements."}

Failing CI:
${failingCi || "No failing CI checks are currently loaded."}

Failed local verification:
${failedVerification || "No failed local verification jobs are currently loaded."}

Draft reviewer comments from this tool:
${openDraftComments || "No draft line comments are currently present."}

Latest existing fix context:
${latestFix ? `${latestFix.source ?? "Fix session"}: ${latestFix.statusMessage ?? latestFix.status}` : "No previous fix session is loaded."}

Analysis summary:
${analysis ? JSON.stringify({
  type: analysis.type,
  summary: analysis.summary,
  reviewerFocus: analysis.reviewerFocusDetails ?? analysis.reviewerFocus,
  risks: analysis.riskDetails ?? analysis.risks,
  testAssessment: analysis.testAssessment,
  testsToCheck: analysis.testsToCheck
}, null, 2) : "No AI analysis is loaded yet."}`;
}
