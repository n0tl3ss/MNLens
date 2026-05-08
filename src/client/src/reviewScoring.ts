import type { AnalysisResult, CiCheck, FixJob, Job, PrDetail, PrListItem, ReviewProgress, VerificationJob } from "../../shared/types";

export type ReviewReadiness = {
  label: string;
  tone: string;
  summary: string;
  blockers: string[];
};

export type ReviewScore = {
  score: number;
  label: string;
  tone: string;
  breakdown: {
    base: number;
    adjustments: ScoreAdjustment[];
    raiseActions: string[];
  };
  effort: {
    label: "quick" | "moderate" | "deep";
    minutes: string;
  };
};

export type ScoreAdjustment = {
  label: string;
  points: number;
  reason: string;
  action?: string;
  tone: string;
};

export function reviewScoreForPr(
  pr: PrListItem,
  context: {
    detail?: PrDetail;
    analysis?: AnalysisResult;
    progress?: ReviewProgress;
    ciChecks?: CiCheck[];
    verificationJobs?: VerificationJob[];
    job?: Job;
    fixJobs?: FixJob[];
    draftComments?: unknown[];
    canApproveWithoutComments?: boolean;
  } = {}
): ReviewScore {
  const detail = context.detail;
  const analysis = context.analysis;
  const ci = ciSummary(context.ciChecks ?? []);
  const pushedFix = latestPushedFix(context.fixJobs ?? []);
  const staleFailingCiAfterFix = Boolean(pushedFix && ci.label === "failing" && latestFailingCiAt(context.ciChecks ?? []) < Date.parse(pushedFix.pushedAt ?? pushedFix.updatedAt));
  const latestVerification = latestVerificationJobs(context.verificationJobs ?? []);
  const changedLines = detail ? detail.additions + detail.deletions : 0;
  const changedFiles = detail?.changedFiles ?? pr.changedFiles ?? 0;
  if (!detail && !analysis && pr.fastScore !== undefined) {
    return fastReviewScore(pr);
  }
  const riskCount = analysis?.risks.length ?? pr.aiRiskCount ?? 0;
  const highSeverity = [...(analysis?.riskDetails ?? []), ...(analysis?.reviewerFocusDetails ?? [])].filter((item) => item.severity === "high").length;
  const docsOnly = isDocsOnlyReview(pr, detail, analysis);
  const lowRiskDocsOnly = docsOnly && highSeverity === 0 && changedFiles <= 3 && changedLines <= 120;
  const manualChecks = context.progress?.manualChecks ?? {};
  const manualStatuses = Object.values(manualChecks);
  const manualPending = analysis
    ? analysis.testsToCheck.filter((item, index) => isGenuineManualVerification(item) && !manualChecks[manualCheckId(item, index)]).length
    : 0;
  const automationPending = analysis?.testsToCheck.filter((item) => isAutomationVerificationCandidate(item)).length ?? 0;
  const requiredVerificationItems = analysis?.testsToCheck.filter((item) => extractRunnableCommand(item) || isGenuineManualVerification(item)).length ?? 0;
  const verificationFailed = latestVerification.some((job) => job.status === "failed");
  const verificationPassed = latestVerification.some((job) => job.status === "done") || manualStatuses.some((item) => item.status === "passed");
  const isFeature = (analysis?.type ?? pr.aiType) === "feature";

  let score = 100;
  const adjustments: ScoreAdjustment[] = [];
  const addScore = (points: number, label: string, reason: string, action?: string, tone?: string) => {
    if (points === 0) return;
    score += points;
    adjustments.push({ label, points, reason, action, tone: tone ?? (points > 0 ? "added" : "danger") });
  };
  if (!analysis && !pr.aiType) addScore(-30, "No score", "The app has no cached fast score or deep review plan.", "Run Fast Analyze visible or Deep Analyze this PR.", "danger");
  if (context.job?.status === "failed") addScore(-25, "Analysis failed", "The latest analysis job failed, so guidance may be stale or missing.", "Reanalyze and inspect the error.", "danger");
  if (context.job?.status === "queued" || context.job?.status === "running") addScore(-12, "Analysis running", "The review guidance is still being generated.", "Wait for analysis to finish.", "queue");
  if (ci.label === "failing") {
    addScore(
      staleFailingCiAfterFix ? -8 : -35,
      staleFailingCiAfterFix ? "Stale failing CI" : "Failing CI",
      staleFailingCiAfterFix ? "A fix was pushed after the failing check, but CI has not been refreshed." : "At least one current CI check is failing.",
      staleFailingCiAfterFix ? "Refresh CI or wait for new checks after the pushed fix." : "Fetch logs, explain the failure, or fix it.",
      staleFailingCiAfterFix ? "queue" : "danger"
    );
  } else if (ci.label === "running") addScore(-15, "CI running", "Final readiness should wait for CI to finish.", "Wait for CI or refresh status.", "queue");
  else if (ci.label === "unknown") addScore(-8, "CI unknown", "The app does not have a clear CI result yet.", "Refresh data or open GitHub checks.", "queue");
  if (verificationFailed) addScore(-30, "Local verification failed", "At least one local run failed.", "Open the run output and fix or explain the failure.", "danger");
  if (requiredVerificationItems > 0 && !verificationPassed) {
    addScore(
      lowRiskDocsOnly ? -4 : isFeature ? -15 : -9,
      "Verification not recorded",
      "The analysis suggested runnable checks or genuinely manual validation, but no passing result is recorded.",
      "Run the suggested command or complete only the genuinely manual checks with evidence.",
      "queue"
    );
  }
  if (manualPending > 0) {
    addScore(
      -(lowRiskDocsOnly ? Math.min(4, manualPending) : Math.min(8, manualPending * 3)),
      "Manual checks open",
      `${manualPending} genuinely manual verification item${manualPending === 1 ? "" : "s"} still need evidence.`,
      "Complete only the checks that require external resources or human judgment.",
      "queue"
    );
  }
  if (automationPending > 0 && !verificationPassed && !lowRiskDocsOnly) {
    addScore(
      -Math.min(5, automationPending * 2),
      "Automation gaps",
      `${automationPending} test item${automationPending === 1 ? "" : "s"} should become runnable coverage instead of manual reviewer work.`,
      "Use Add automated test in Tests To Check or improve tests in Fix.",
      "queue"
    );
  }
  if (manualStatuses.some((item) => item.status === "failed")) addScore(-25, "Manual check failed", "A reviewer-marked check needs follow-up.", "Fix the issue or document why it is not a PR blocker.", "danger");
  const riskPenalty = lowRiskDocsOnly ? Math.min(8, riskCount * 2 + highSeverity * 5) : Math.min(22, riskCount * 4 + highSeverity * 5);
  addScore(
    -riskPenalty,
    "Risk load",
    `${riskCount} risk${riskCount === 1 ? "" : "s"} and ${highSeverity} high-severity point${highSeverity === 1 ? "" : "s"} increase required review effort.`,
    highSeverity > 0 ? "Address high-severity source issues or mark them accepted with evidence." : "Mark resolved/accepted risks or reduce the unresolved review concerns.",
    riskPenalty >= 15 ? "danger" : "queue"
  );
  if (analysis?.testAssessment?.rating === "weak") addScore(lowRiskDocsOnly ? -4 : -18, "Weak tests", "Current tests do not prove enough of the changed behavior.", "Improve test coverage or record why the remaining gap is acceptable.", "danger");
  if (analysis?.testAssessment?.rating === "partial") addScore(lowRiskDocsOnly ? 0 : -10, "Partial tests", "Some behavior is covered, but important edge cases remain.", "Run or add tests for the missing source-code edge cases.", "queue");
  if (analysis?.testAssessment?.rating === "good") addScore(4, "Good tests", "The test assessment supports review confidence.", undefined, "added");
  if (analysis?.testAssessment?.rating === "strong") addScore(8, "Strong tests", "The changed behavior appears well covered.", undefined, "added");
  if ((changedFiles > 12 || changedLines > 700) && highSeverity > 0) {
    addScore(-3, "Large risky change", `${changedFiles} files and ${changedLines} changed lines make unresolved high-severity risks harder to clear.`, "Address the high-severity source issues; size mostly affects review effort, not merge readiness.", "queue");
  } else if (changedFiles <= 3 && changedLines <= 80 && (riskCount <= 2 || lowRiskDocsOnly)) {
    addScore(lowRiskDocsOnly ? 10 : 6, "Small focused PR", "The PR is small enough that review effort should stay low.", undefined, "added");
  }
  if (isFeature && !analysis?.similarImplementations?.length && changedLines > 120) addScore(-8, "Missing comparison", "This feature lacks similar implementation evidence.", "Run research or add comparable docs/examples.", "queue");
  if (context.canApproveWithoutComments) addScore(8, "Plan complete", "Wizard items and files are checked, and approval is allowed.", undefined, "added");
  if (pushedFix?.pushed) addScore(8, "Fix pushed", "A Codex fix was pushed from this review flow.", "Review the updated diff and refresh CI.", "added");
  if (pr.reviewDecision === "APPROVED") addScore(8, "GitHub approved", "GitHub already records an approval.", undefined, "added");
  if (pr.reviewDecision === "CHANGES_REQUESTED" && !pushedFix?.pushed) addScore(-10, "Open change request", "GitHub still shows changes requested and no pushed fix is recorded in this app.", "Review author updates or push/inspect the prepared fix.", "queue");

  const clamped = Math.max(1, Math.min(100, Math.round(score)));
  return {
    score: clamped,
    label: lowRiskDocsOnly && clamped >= 75 ? "docs quick check" : clamped >= 85 ? "mostly mergeable" : clamped >= 65 ? "reviewable" : clamped >= 40 ? "work left" : "blocked",
    tone: clamped >= 85 ? "added" : clamped >= 65 ? "improvement" : clamped >= 40 ? "queue" : "danger",
    breakdown: {
      base: 100,
      adjustments,
      raiseActions: scoreRaiseActions(adjustments, clamped)
    },
    effort: reviewEffort(detail, analysis, riskCount, highSeverity, manualPending)
  };
}

function fastReviewScore(pr: PrListItem): ReviewScore {
  const score = Math.max(1, Math.min(100, Math.round(pr.fastScore ?? 1)));
  return {
    score,
    label: pr.fastScoreLabel ?? (score >= 85 ? "fast green" : score >= 65 ? "fast reviewable" : score >= 40 ? "fast work left" : "fast blocked"),
    tone: pr.fastScoreTone ?? (score >= 85 ? "added" : score >= 65 ? "improvement" : score >= 40 ? "queue" : "danger"),
    breakdown: {
      base: 100,
      adjustments: [
        {
          label: "Fast estimate",
          points: score - 100,
          reason: `Estimated from PR metadata and changed file stats. Confidence: ${pr.fastScoreConfidence ?? "low"}.`,
          action: "Run Deep Analyze on PRs you may review or fix.",
          tone: "queue"
        }
      ],
      raiseActions: ["Run Deep Analyze for full risks, tests, comments, and research before approving."]
    },
    effort: {
      label: score >= 80 && (pr.changedFiles ?? 0) <= 4 ? "quick" : score >= 55 ? "moderate" : "deep",
      minutes: score >= 80 && (pr.changedFiles ?? 0) <= 4 ? "5-10 min" : score >= 55 ? "15-30 min" : "45+ min"
    }
  };
}

export function readinessForPr(
  pr: PrListItem,
  context: {
    detail?: PrDetail;
    analysis?: AnalysisResult;
    progress?: ReviewProgress;
    ciChecks?: CiCheck[];
    verificationJobs?: VerificationJob[];
    job?: Job;
    fixJobs?: FixJob[];
    draftComments?: unknown[];
    canApproveWithoutComments?: boolean;
  } = {}
): ReviewReadiness {
  const blockers: string[] = [];
  const job = context.job;
  const analysis = context.analysis;
  const pushedFix = latestPushedFix(context.fixJobs ?? []);
  const ci = ciSummary(context.ciChecks ?? []);
  const latestVerification = latestVerificationJobs(context.verificationJobs ?? []);
  const docsOnly = isDocsOnlyReview(pr, context.detail, analysis);
  const highSeverity = [...(analysis?.riskDetails ?? []), ...(analysis?.reviewerFocusDetails ?? [])].filter((item) => item.severity === "high").length;
  const lowRiskDocsOnly = docsOnly && highSeverity === 0 && (context.detail?.changedFiles ?? pr.changedFiles ?? 0) <= 3;
  const manualChecks = context.progress?.manualChecks ?? {};
  const manualStatuses = Object.values(manualChecks);
  const manualFailed = manualStatuses.filter((item) => item.status === "failed").length;
  const manualPending = analysis
    ? analysis.testsToCheck.filter((item, index) => isGenuineManualVerification(item) && !manualChecks[manualCheckId(item, index)]).length
    : 0;
  const requiredVerificationItems = analysis?.testsToCheck.filter((item) => extractRunnableCommand(item) || isGenuineManualVerification(item)).length ?? 0;

  if (pr.reviewDecision === "APPROVED") return { label: "approved", tone: "added", summary: "This PR already has an approval recorded by GitHub.", blockers };
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    if (pushedFix) {
      return {
        label: "fix pushed",
        tone: "queue",
        summary: "Changes were requested on GitHub, but a fix was pushed from this review flow. Review the updated PR state and approve or request remaining changes.",
        blockers
      };
    }
    return {
      label: "waiting on author",
      tone: "danger",
      summary: "A previous review requested changes, so the next useful action is checking the author's update.",
      blockers: ["Changes were requested on GitHub."]
    };
  }
  if (job?.status === "queued" || job?.status === "running") return { label: "analyzing", tone: "queue", summary: "Codex is building review guidance for this PR.", blockers };
  if (job?.status === "failed") {
    return {
      label: "analysis failed",
      tone: "danger",
      summary: "The AI analysis failed, so review guidance may be stale or missing.",
      blockers: [job.error ?? "Re-run analysis."]
    };
  }
  if (!analysis && !pr.aiType) {
    return {
      label: "needs score",
      tone: "neutral",
      summary: "Run Fast Analyze for queue sorting, or Deep Analyze before relying on the review wizard and research sections.",
      blockers: ["No fast score or deep analysis is cached for this PR."]
    };
  }
  if (ci.label === "failing") {
    blockers.push("CI is failing.");
    return { label: "CI failing", tone: "danger", summary: "Do not approve until the failing CI checks are understood.", blockers };
  }
  if (ci.label === "running") {
    blockers.push("CI is still running.");
    return { label: "CI running", tone: "queue", summary: "Review can continue, but final approval should wait for CI.", blockers };
  }
  if (latestVerification.some((job) => job.status === "failed")) {
    blockers.push("At least one local verification failed.");
    return { label: "local failure", tone: "danger", summary: "Local verification found a failure that should be resolved or explained.", blockers };
  }
  if (manualFailed > 0) {
    blockers.push(`${manualFailed} manual check ${manualFailed === 1 ? "needs" : "need"} follow-up.`);
    return { label: "manual follow-up", tone: "danger", summary: "A manual verification item was marked as needing follow-up.", blockers };
  }
  if (manualPending > 0 && !lowRiskDocsOnly) {
    blockers.push(`${manualPending} manual check ${manualPending === 1 ? "is" : "are"} not recorded yet.`);
    return { label: "manual checks open", tone: "queue", summary: "Some genuinely manual verification items still need evidence.", blockers };
  }
  if (requiredVerificationItems > 0 && latestVerification.length === 0 && manualStatuses.length === 0 && !lowRiskDocsOnly) {
    blockers.push("No runnable or genuinely manual verification has been recorded.");
    return { label: "needs verification", tone: "queue", summary: "The analysis proposed runnable/manual checks, but none have been recorded yet.", blockers };
  }
  if ((analysis?.risks.length ?? pr.aiRiskCount ?? 0) >= 4 || (context.detail && context.detail.additions + context.detail.deletions > 500)) {
    return { label: "high-risk review", tone: "queue", summary: "This PR has enough risk or size that it needs a careful human pass before approval.", blockers };
  }
  if (context.canApproveWithoutComments) return { label: "ready to approve", tone: "added", summary: "Wizard items and files are checked, and no blockers are visible in the app.", blockers };
  if (lowRiskDocsOnly) {
    return {
      label: "docs quick check",
      tone: "added",
      summary: "This looks like a small documentation-only PR. Review the wording/rendering, but missing local verification is not a hard blocker.",
      blockers
    };
  }
  return { label: "ready to review", tone: "improvement", summary: "No hard blocker is visible; continue the wizard and diff review.", blockers };
}

function latestVerificationJobs(jobs: VerificationJob[]): VerificationJob[] {
  const latest = new Map<string, VerificationJob>();
  for (const job of [...jobs].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    latest.set(commandKey(job.command), job);
  }
  return [...latest.values()];
}

function latestPushedFix(fixJobs: FixJob[]): FixJob | undefined {
  return fixJobs
    .filter((job) => job.status === "done" && job.pushed)
    .sort((a, b) => Date.parse(b.pushedAt ?? b.updatedAt) - Date.parse(a.pushedAt ?? a.updatedAt))[0];
}

function scoreRaiseActions(adjustments: ScoreAdjustment[], score: number): string[] {
  const actions = adjustments
    .filter((item) => item.points < 0 && item.action)
    .sort((a, b) => a.points - b.points)
    .map((item) => item.action!)
    .filter((action, index, all) => all.indexOf(action) === index);
  if (actions.length > 0) return actions;
  if (score < 85) return ["Complete the wizard review, inspect the changed source files, and record the remaining verification evidence."];
  return [];
}

function latestFailingCiAt(checks: CiCheck[]): number {
  const times = checks
    .filter((check) => check.bucket === "fail" || /fail|error|cancel/i.test(check.state))
    .map((check) => Date.parse(usableCheckTime(check)))
    .filter((value) => Number.isFinite(value));
  return times.length > 0 ? Math.max(...times) : Number.NaN;
}

function reviewEffort(detail: PrDetail | undefined, analysis: AnalysisResult | undefined, riskCount: number, highSeverity: number, manualPending: number): ReviewScore["effort"] {
  const changedLines = detail ? detail.additions + detail.deletions : 0;
  const changedFiles = detail?.changedFiles ?? 0;
  const type = analysis?.type ?? "unknown";
  const docsOnly = isDocsOnlyReview(undefined, detail, analysis);
  let points = 0;
  points += Math.min(6, Math.ceil(changedFiles / 3));
  points += Math.min(8, Math.ceil(changedLines / 120));
  points += Math.min(8, riskCount);
  points += highSeverity * 2;
  points += manualPending;
  if (type === "feature") points += 4;
  if (type === "bug" && changedLines <= 80 && riskCount <= 2) points -= 3;
  if (type === "improvement" && changedLines <= 140 && riskCount <= 3) points -= 2;
  if (docsOnly && changedLines <= 120 && highSeverity === 0) points -= 5;
  if (analysis?.testAssessment?.rating === "strong" || analysis?.testAssessment?.rating === "good") points -= 2;
  if (analysis?.testAssessment?.rating === "weak" && !docsOnly) points += 3;

  if (points <= 5) return { label: "quick", minutes: "5-10 min" };
  if (points <= 13) return { label: "moderate", minutes: "15-30 min" };
  return { label: "deep", minutes: "45+ min" };
}

function ciSummary(checks: CiCheck[]): { label: string; tone: string } {
  if (checks.length === 0) return { label: "unknown", tone: "neutral" };
  if (checks.some((check) => check.bucket === "fail" || /fail|error|cancel/i.test(check.state))) return { label: "failing", tone: "danger" };
  if (checks.some((check) => check.bucket === "pending" || /pending|queued|in_progress/i.test(check.state))) return { label: "running", tone: "queue" };
  if (checks.every((check) => check.bucket === "pass" || check.state === "SUCCESS")) return { label: "passing", tone: "added" };
  return { label: "mixed", tone: "neutral" };
}

function usableCheckTime(check: CiCheck): string {
  return [check.completedAt, check.startedAt].find((value) => value && !value.startsWith("0001-")) ?? "";
}

function isDocsOnlyReview(pr?: PrListItem, detail?: PrDetail, analysis?: AnalysisResult): boolean {
  const type = analysis?.type ?? pr?.aiType;
  if (type === "docs") return true;
  if (!detail?.files.length) return false;
  return detail.files.every((file) => isDocsPath(file.path));
}

function isDocsPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.startsWith("docs/") || lower.startsWith("src/main/docs/") || lower.endsWith(".adoc") || lower.endsWith(".md") || lower.endsWith(".rst") || lower.endsWith(".txt");
}

function extractRunnableCommand(text: string): string | undefined {
  let trimmed = text.trim();
  const fenced = /```(?:\w+)?\s*([\s\S]*?)\s*```/.exec(trimmed);
  if (fenced) trimmed = fenced[1].trim();
  const inline = /`([^`]+)`/.exec(trimmed);
  if (inline) trimmed = inline[1].trim();
  if (/^(?:bash|sh|zsh|fish|cmd|powershell|pwsh)\b/i.test(trimmed)) return undefined;
  const commandMatch = /((?:\.\/)?(?:gradlew|mvnw)\b[^\n]*|(?:gradle|mvn|npm|pnpm|yarn|make|go|cargo)\b[^\n]*)/.exec(trimmed);
  return commandMatch?.[1].replace(/[.)\]]+$/g, "").trim();
}

function isGenuineManualVerification(item: string): boolean {
  const text = item.toLowerCase();
  if (isDocRenderVerificationItem(item)) return true;
  if (/manual verification\s*:/.test(text)) return true;
  return /\b(real cloud|cloud account|credentials?|secret|token|paid service|external service|oracle cloud|aws|azure|gcp|oci|otlp endpoint|release permission|browser|visual|screenshot|human judgment|cannot be automated)\b/.test(text);
}

function isAutomationVerificationCandidate(item: string): boolean {
  return !extractRunnableCommand(item) && !isGenuineManualVerification(item);
}

function isDocRenderVerificationItem(item: string): boolean {
  const text = item.toLowerCase();
  return /\b(build|render|screenshot|html|site)\b/.test(text) && /\b(docs?|documentation|asciidoc|adoc|guide)\b/.test(text);
}

function commandKey(command: string): string {
  return command
    .trim()
    .replace(/[`"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.)\]]+$/g, "")
    .trim();
}

function manualCheckId(item: string, index: number): string {
  let hash = 0;
  for (const char of item) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `manual:${index}:${hash.toString(16)}`;
}
