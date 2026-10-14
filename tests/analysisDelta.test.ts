import { describe, expect, it } from "vitest";
import { computeAnalysisDelta, observationKey } from "../src/server/analysisDelta.js";
import type { AnalysisResult, EdgeCaseInsight, ReviewInsight } from "../src/shared/types.js";

const insight = (title: string, observation: string, severity: ReviewInsight["severity"] = "medium", location?: string): ReviewInsight => ({
  title,
  observation,
  perspective: "",
  recommendation: "",
  severity,
  location
});

const analysis = (diffHash: string, parts: Partial<Pick<AnalysisResult, "riskDetails" | "reviewerFocusDetails" | "assumptions" | "edgeCases">>): AnalysisResult => ({
  prKey: "acme__app__7",
  diffHash,
  type: "feature",
  confidence: 0.8,
  summary: "",
  evidence: [],
  reviewerFocus: [],
  risks: [],
  testsToCheck: [],
  caveats: [],
  draftComment: "",
  generatedAt: diffHash === "old" ? "2026-10-01T10:00:00.000Z" : "2026-10-02T10:00:00.000Z",
  ...parts
});

describe("analysis delta", () => {
  it("matches findings by normalized title first, then by observation text, and reports the rest as resolved or added", () => {
    const previous = analysis("old", {
      riskDetails: [
        insight("Missing null-check in parser", "parseConfig dereferences options.path without checking that options is defined.", "high", "src/parser.ts:41"),
        insight("Retry loop never backs off", "The reconnect loop retries immediately in a tight loop when the socket closes.", "medium"),
        insight("Unbounded cache growth", "Entries are added to the LRU without an eviction policy.", "low")
      ],
      reviewerFocusDetails: [insight("Config migration path", "Existing config files have no `version` field.", "medium")]
    });
    const next = analysis("new", {
      riskDetails: [
        insight("Missing Null Check in Parser!", "parseConfig still dereferences options.path without a guard.", "high", "src/parser.ts:44"),
        insight("Reconnect loop retries without a delay", "The reconnect loop retries immediately in a tight loop when the socket closes, which can saturate the broker.", "medium"),
        insight("Secrets logged at debug level", "The connection string is written to the debug log.", "high")
      ],
      reviewerFocusDetails: [insight("Config migration path", "Existing config files have no `version` field.", "medium")]
    });

    const delta = computeAnalysisDelta(previous, next);
    expect(delta.previousDiffHash).toBe("old");
    expect(delta.previousGeneratedAt).toBe("2026-10-01T10:00:00.000Z");

    expect(delta.persisting.map((item) => [item.title, item.matchedBy, item.previousTitle])).toEqual([
      ["Missing Null Check in Parser!", "title", undefined],
      ["Reconnect loop retries without a delay", "observation", "Retry loop never backs off"],
      ["Config migration path", "title", undefined]
    ]);
    expect(delta.resolved.map((item) => item.title)).toEqual(["Unbounded cache growth"]);
    expect(delta.added.map((item) => [item.kind, item.title, item.severity])).toEqual([["risk", "Secrets logged at debug level", "high"]]);
    expect(delta.carriedVerdicts).toBe(0);
  });

  it("counts a severity change as persisting and records the previous severity", () => {
    const previous = analysis("old", { assumptions: [insight("Pools are created as beans", "Only pools that go through the bean context are instrumented.", "low")] });
    const next = analysis("new", { assumptions: [insight("Pools are created as beans", "Only pools that go through the bean context are instrumented.", "high")] });
    const delta = computeAnalysisDelta(previous, next);
    expect(delta.resolved).toEqual([]);
    expect(delta.added).toEqual([]);
    expect(delta.persisting).toHaveLength(1);
    expect(delta.persisting[0]).toMatchObject({ kind: "assumption", severity: "high", previousSeverity: "low", matchedBy: "title" });
    expect(delta.persisting[0].previousTitle).toBeUndefined();
  });

  it("never matches across kinds and covers edge cases", () => {
    const edge = (title: string, observation: string, covered: EdgeCaseInsight["covered"]): EdgeCaseInsight => ({ ...insight(title, observation, "medium"), covered });
    const previous = analysis("old", {
      riskDetails: [insight("Pool closed before metrics registered", "A pool closed during startup leaves a dangling registration.")],
      edgeCases: [edge("Empty pool list", "register() is called with no pools.", "no")]
    });
    const next = analysis("new", {
      edgeCases: [edge("Pool closed before metrics registered", "A pool closed during startup leaves a dangling registration.", "yes"), edge("Empty pool list", "register() is called with no pools.", "yes")]
    });
    const delta = computeAnalysisDelta(previous, next);
    expect(delta.resolved.map((item) => [item.kind, item.title])).toEqual([["risk", "Pool closed before metrics registered"]]);
    expect(delta.added.map((item) => [item.kind, item.title])).toEqual([["edge-case", "Pool closed before metrics registered"]]);
    expect(delta.persisting.map((item) => [item.kind, item.title])).toEqual([["edge-case", "Empty pool list"]]);
  });

  it("does not treat two different observations that merely share a few words as the same finding", () => {
    const previous = analysis("old", { riskDetails: [insight("A", "The parser reads the config file twice on startup and logs each read.", "low")] });
    const next = analysis("new", { riskDetails: [insight("B", "The parser never closes the config file handle after the startup read.", "low")] });
    const delta = computeAnalysisDelta(previous, next);
    expect(delta.persisting).toEqual([]);
    expect(delta.resolved).toHaveLength(1);
    expect(delta.added).toHaveLength(1);
  });

  it("normalizes observation text like review memory does", () => {
    expect(observationKey("The parser reads the config file twice!")).toBe(observationKey("Parser reads config file twice..."));
    expect(observationKey("Parser reads the config file twice")).not.toBe(observationKey("Parser closes the config file twice"));
  });
});
