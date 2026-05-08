import { describe, expect, it } from "vitest";
import type { AnalysisResult, PrDetail } from "../src/shared/types";
import { buildOverviewLinePins, buildReviewChecklist, isReviewPlanComplete, rankFiles } from "../src/client/src/planHelpers";

const now = "2026-05-08T10:00:00.000Z";

function detail(overrides: Partial<PrDetail> = {}): PrDetail {
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
    changedFiles: 2,
    body: "",
    linkedIssues: [],
    baseRefName: "main",
    headRefName: "feature",
    additions: 12,
    deletions: 2,
    files: [
      { path: "src/main/java/example/Feature.java", additions: 6, deletions: 1 },
      { path: "src/test/java/example/FeatureTest.java", additions: 6, deletions: 1 }
    ],
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
    type: "feature",
    confidence: 0.9,
    summary: "Adds feature.",
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

describe("plan helpers", () => {
  it("builds required checklist and recognizes completed review plan", () => {
    const pr = detail();
    const checklist = buildReviewChecklist(pr, analysis({ reviewerFocus: ["Check lifecycle."] }));
    const progress = {
      prKey: pr.key,
      checkedItems: checklist.slice(0, 3).map((item) => item.id),
      reviewedFiles: pr.files.map((file) => file.path),
      ignoredRuleIds: [],
      manualChecks: {},
      notes: "",
      updatedAt: now
    };

    expect(checklist[0].id).toBe("understand-change");
    expect(isReviewPlanComplete(pr, analysis(), progress)).toBe(true);
  });

  it("ranks source files before tests and support files", () => {
    const ranked = rankFiles(detail());

    expect(ranked[0].path).toBe("src/main/java/example/Feature.java");
    expect(ranked[1].path).toBe("src/test/java/example/FeatureTest.java");
  });

  it("pins overview comments to changed behavior lines instead of imports", () => {
    const pr = detail({
      diff: [
        "diff --git a/src/main/java/example/Feature.java b/src/main/java/example/Feature.java",
        "--- a/src/main/java/example/Feature.java",
        "+++ b/src/main/java/example/Feature.java",
        "@@ -1,4 +1,5 @@",
        " import java.util.List;",
        " public class Feature {",
        "+  void registerMetrics(Object pool) { telemetry.registerMetrics(pool); }",
        " }"
      ].join("\n")
    });
    const pins = buildOverviewLinePins(
      pr.files[0],
      analysis({
        riskDetails: [{
          title: "Lifecycle registration",
          observation: "registerMetrics must be paired with unregisterMetrics.",
          perspective: "Lifecycle leaks are possible.",
          recommendation: "Add lifecycle coverage.",
          severity: "high"
        }]
      }),
      pr.diff
    );

    expect(pins[0]?.target.line).toBe(3);
    expect(pins[0]?.draftBody).toMatch(/lifecycle|coverage/i);
  });
});
