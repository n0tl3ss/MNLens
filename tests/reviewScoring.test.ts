import { describe, expect, it } from "vitest";
import { readinessForPr, reviewScoreForPr } from "../src/client/src/reviewScoring";
import type { AnalysisResult, CiCheck, FixJob, PrDetail, PrListItem } from "../src/shared/types";

const now = "2026-05-08T10:00:00.000Z";

function pr(overrides: Partial<PrListItem> = {}): PrListItem {
  return {
    key: "example__repo__1",
    owner: "example",
    repo: "repo",
    number: 1,
    title: "Example PR",
    url: "https://github.com/example/repo/pull/1",
    repository: "example/repo",
    author: "author",
    labels: [],
    queues: ["review-requested"],
    state: "OPEN",
    isDraft: false,
    createdAt: now,
    updatedAt: now,
    commentsCount: 0,
    changedFiles: 1,
    ...overrides
  };
}

function detail(overrides: Partial<PrDetail> = {}): PrDetail {
  const base = pr(overrides);
  return {
    ...base,
    body: "",
    linkedIssues: [],
    baseRefName: "main",
    headRefName: "feature",
    additions: 12,
    deletions: 3,
    changedFiles: 1,
    files: [{ path: "src/main/docs/guide/example.adoc", additions: 12, deletions: 3, changeType: "MODIFIED" }],
    commits: [],
    conversationComments: [],
    reviewSummaries: [],
    reviewComments: [],
    diff: "",
    diffHash: "hash",
    ...overrides
  };
}

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    prKey: "example__repo__1",
    diffHash: "hash",
    type: "docs",
    confidence: 0.9,
    summary: "Updates docs.",
    evidence: [],
    reviewerFocus: [],
    risks: [],
    testsToCheck: [],
    docs: [],
    similarImplementations: [],
    caveats: [],
    draftComment: "",
    generatedAt: now,
    ...overrides
  };
}

function ci(state: "pass" | "fail" | "pending"): CiCheck {
  return {
    name: "build",
    workflow: "build",
    state: state === "pass" ? "SUCCESS" : state === "fail" ? "FAILURE" : "IN_PROGRESS",
    bucket: state,
    description: "",
    link: "",
    startedAt: now,
    completedAt: state === "pending" ? "" : now,
    canFetchLog: true
  };
}

describe("review scoring", () => {
  it("keeps a small docs-only PR lightweight", () => {
    const item = pr({ aiType: "docs" });
    const score = reviewScoreForPr(item, {
      detail: detail(),
      analysis: analysis({ testAssessment: { rating: "good", summary: "Docs changed only.", covered: [], gaps: [], recommendedTests: [] } }),
      ciChecks: [ci("pass")]
    });
    const readiness = readinessForPr(item, { detail: detail(), analysis: analysis(), ciChecks: [ci("pass")] });

    expect(score.score).toBeGreaterThanOrEqual(85);
    expect(score.label).toBe("docs quick check");
    expect(score.effort.label).toBe("quick");
    expect(readiness.label).toBe("docs quick check");
  });

  it("treats failing CI as a hard readiness blocker", () => {
    const item = pr({ aiType: "bug" });
    const sourceDetail = detail({
      additions: 20,
      deletions: 4,
      files: [{ path: "src/main/java/example/BugFix.java", additions: 20, deletions: 4 }]
    });
    const score = reviewScoreForPr(item, { detail: sourceDetail, analysis: analysis({ type: "bug" }), ciChecks: [ci("fail")] });
    const readiness = readinessForPr(item, { detail: sourceDetail, analysis: analysis({ type: "bug" }), ciChecks: [ci("fail")] });

    expect(score.breakdown.adjustments.some((adjustment) => adjustment.label === "Failing CI")).toBe(true);
    expect(score.score).toBeLessThan(75);
    expect(readiness.label).toBe("CI failing");
    expect(readiness.blockers).toContain("CI is failing.");
  });

  it("does not keep a pushed fix blocked only because GitHub still says changes requested", () => {
    const item = pr({ aiType: "improvement", reviewDecision: "CHANGES_REQUESTED" });
    const pushedFix: FixJob = {
      id: "fix-1",
      prKey: item.key,
      status: "done",
      createdAt: now,
      updatedAt: now,
      pushedAt: now,
      pushed: true,
      stdout: "",
      stderr: ""
    };

    const score = reviewScoreForPr(item, { detail: detail(), analysis: analysis({ type: "improvement" }), ciChecks: [ci("pass")], fixJobs: [pushedFix] });
    const readiness = readinessForPr(item, { detail: detail(), analysis: analysis({ type: "improvement" }), ciChecks: [ci("pass")], fixJobs: [pushedFix] });

    expect(score.breakdown.adjustments.some((adjustment) => adjustment.label === "Open change request")).toBe(false);
    expect(score.breakdown.adjustments.some((adjustment) => adjustment.label === "Fix pushed")).toBe(true);
    expect(readiness.label).toBe("fix pushed");
  });

  it("surfaces weak feature tests and automation gaps as score-raising actions", () => {
    const feature = pr({ aiType: "feature", changedFiles: 4 });
    const featureDetail = detail({
      additions: 220,
      deletions: 20,
      changedFiles: 4,
      files: [
        { path: "src/main/java/example/Feature.java", additions: 140, deletions: 10 },
        { path: "src/test/java/example/FeatureTest.java", additions: 80, deletions: 10 }
      ]
    });
    const featureAnalysis = analysis({
      type: "feature",
      risks: ["Lifecycle is untested."],
      riskDetails: [{ title: "Lifecycle", observation: "No lifecycle test.", perspective: "This can silently fail.", recommendation: "Add lifecycle coverage.", severity: "high" }],
      testsToCheck: ["Add/run a lifecycle regression test for the new integration."],
      testAssessment: { rating: "weak", summary: "Only bean creation is covered.", covered: [], gaps: ["No lifecycle test."], recommendedTests: ["Lifecycle regression."] }
    });

    const score = reviewScoreForPr(feature, { detail: featureDetail, analysis: featureAnalysis, ciChecks: [ci("pass")] });

    expect(score.score).toBeLessThan(75);
    expect(score.breakdown.adjustments.some((adjustment) => adjustment.label === "Weak tests")).toBe(true);
    expect(score.breakdown.adjustments.some((adjustment) => adjustment.label === "Automation gaps")).toBe(true);
    expect(score.breakdown.raiseActions.join(" ")).toMatch(/test|coverage/i);
  });
});
