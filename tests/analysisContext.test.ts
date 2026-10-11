import { describe, expect, it } from "vitest";
import { analysisContextHash, analysisFreshness } from "../src/shared/analysisContext.js";

const base = {
  diffHash: "abc",
  baseRefName: "main",
  linkedIssues: [{ number: 1, title: "t", url: "u", state: "OPEN", updatedAt: "2026-01-01" }],
  conversationComments: [{ id: 1, author: "a", url: "", body: "hi", createdAt: "" }],
  reviewSummaries: [{ id: 5, author: "r", url: "", body: "", createdAt: "", state: "COMMENTED" }],
  reviewComments: [{ id: 9, author: "r", url: "", body: "", createdAt: "", path: "a.ts", isResolved: false }]
};

describe("analysis context hash", () => {
  it("is stable for the same discussion state regardless of order", () => {
    const reordered = { ...base, conversationComments: [...base.conversationComments].reverse() };
    expect(analysisContextHash(base)).toBe(analysisContextHash(reordered));
  });

  it("changes when a thread is resolved, a review is added, or the base moves", () => {
    const resolved = { ...base, reviewComments: [{ ...base.reviewComments[0], isResolved: true }] };
    const reviewed = { ...base, reviewSummaries: [...base.reviewSummaries, { id: 6, author: "x", url: "", body: "", createdAt: "", state: "APPROVED" }] };
    const retargeted = { ...base, baseRefName: "release" };
    for (const variant of [resolved, reviewed, retargeted]) expect(analysisContextHash(variant)).not.toBe(analysisContextHash(base));
  });

  it("reports freshness states", () => {
    const hash = analysisContextHash(base);
    expect(analysisFreshness({ diffHash: "abc", contextHash: hash }, base)).toBe("fresh");
    expect(analysisFreshness({ diffHash: "abc", contextHash: "other" }, base)).toBe("context-changed");
    expect(analysisFreshness({ diffHash: "zzz", contextHash: hash }, base)).toBe("diff-changed");
    expect(analysisFreshness({ diffHash: "abc" }, base)).toBe("fresh");
    expect(analysisFreshness(undefined, base)).toBe("unknown");
  });
});
