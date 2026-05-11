import { describe, expect, it } from "vitest";
import type { FixJob, Job, PrDetail, PrListItem } from "../src/shared/types";
import {
  comparePrs,
  groupPrsByRepository,
  insightScope,
  isDocsOnlyReview,
  latestPushedFix,
  sourceChangedLines,
  triageForPr
} from "../src/client/src/reviewHelpers";

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
  return {
    ...pr(overrides),
    body: "",
    linkedIssues: [],
    baseRefName: "main",
    headRefName: "feature",
    additions: 10,
    deletions: 2,
    files: [{ path: "src/main/java/example/Feature.java", additions: 8, deletions: 1 }, { path: "src/test/java/example/FeatureTest.java", additions: 2, deletions: 1 }],
    commits: [],
    conversationComments: [],
    reviewSummaries: [],
    reviewComments: [],
    diff: "",
    diffHash: "hash",
    ...overrides
  };
}

describe("review helpers", () => {
  it("groups PRs by repository and counts items without analysis", () => {
    const analyzedJob: Job = { id: "job-1", prKey: "a__repo__1", status: "done", createdAt: now, updatedAt: now };
    const prs = [
      pr({ key: "a__repo__1", repository: "a/repo", title: "Analyzed" }),
      pr({ key: "a__repo__2", repository: "a/repo", title: "Needs analysis" }),
      pr({ key: "b__repo__3", repository: "b/repo", title: "Other" })
    ];

    const groups = groupPrsByRepository(prs, (key) => (key === analyzedJob.prKey ? analyzedJob : undefined));

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.repository === "a/repo")?.unanalyzed).toBe(1);
    expect(groups.find((group) => group.repository === "b/repo")?.unanalyzed).toBe(1);
  });

  it("sorts by requested field and uses triage as a tie-breaker", () => {
    const older = pr({ key: "old", title: "B", updatedAt: "2026-05-07T10:00:00.000Z" });
    const newer = pr({ key: "new", title: "A", updatedAt: "2026-05-08T10:00:00.000Z" });

    expect(comparePrs(newer, older, "name", "asc", () => undefined, () => ({ score: 50 } as never))).toBeLessThan(0);
    expect(comparePrs(newer, older, "date", "desc", () => undefined, () => ({ score: 50 } as never))).toBeLessThan(0);
  });

  it("does not treat a pushed fix as blocked by stale changes-requested state", () => {
    const fix: FixJob = { id: "fix-1", prKey: "p", status: "done", createdAt: now, updatedAt: now, pushed: true, pushedAt: now, stdout: "", stderr: "" };
    const triage = triageForPr(pr({ reviewDecision: "CHANGES_REQUESTED" }), undefined, [fix]);

    expect(latestPushedFix([fix])).toBe(fix);
    expect(triage.label).toBe("fix pushed");
    expect(triage.tone).toBe("queue");
  });

  it("surfaces branch freshness separately from merge-state conflicts", () => {
    const triage = triageForPr(pr({ mergeStateStatus: "CLEAN", branchBehindBy: 3 }));

    expect(triage.label).toBe("branch behind");
    expect(triage.nextAction).toBe("Update branch");
  });

  it("separates source lines from tests and docs", () => {
    expect(sourceChangedLines(detail())).toBe(9);
    expect(isDocsOnlyReview(undefined, detail({ files: [{ path: "src/main/docs/guide.adoc", additions: 3, deletions: 0 }] }))).toBe(true);
  });

  it("labels test-only insight scope separately from source risk", () => {
    expect(insightScope({ title: "Global Logger Mutation", observation: "Test logger mutation can leak between specs." })).toBe("test-maintainability");
    expect(insightScope({ title: "Lifecycle leak", observation: "Source listener can leak callbacks." })).toBe("source");
  });
});
