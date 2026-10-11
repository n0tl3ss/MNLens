import { describe, expect, it } from "vitest";
import { patternKey, summarizeMemory, verdictKey } from "../src/server/reviewMemory.js";
import type { FindingFeedback } from "../src/shared/types.js";

const entry = (title: string, verdict: FindingFeedback["verdict"], prKey = "acme__app__1"): FindingFeedback => ({
  id: title + verdict + prKey,
  prKey,
  repository: "acme/app",
  kind: "risk",
  title,
  verdict,
  at: ""
});

describe("review memory", () => {
  it("buckets similarly worded findings together", () => {
    expect(patternKey("Missing null check in parser")).toBe(patternKey("Null check missing for the parser"));
    expect(patternKey("Missing null check in parser")).not.toBe(patternKey("Thread safety of cache"));
    expect(verdictKey("risk", "Missing Null-Check!")).toBe("risk:missing null check");
  });

  it("suggests skip rules for repeatedly dismissed patterns and keeps per-PR verdicts", () => {
    const summary = summarizeMemory(
      "acme/app",
      [entry("Missing null check in parser", "dismissed"), entry("Null check missing in parser", "dismissed", "acme__app__2"), entry("Thread safety of cache", "kept"), entry("Cache thread safety", "kept", "acme__app__2"), entry("Thread-safety of the cache", "kept", "acme__app__3")],
      "acme__app__1"
    );
    expect(summary.total).toBe(5);
    const skip = summary.patterns.find((pattern) => pattern.dismissed === 2);
    expect(skip?.suggestedRule).toContain("Do not raise findings like");
    const keep = summary.patterns.find((pattern) => pattern.kept === 3);
    expect(keep?.suggestedRule).toContain("Always check");
    expect(summary.prVerdicts[verdictKey("risk", "Missing null check in parser")]).toBe("dismissed");
    expect(summary.prVerdicts[verdictKey("risk", "Thread safety of cache")]).toBe("kept");
    expect(Object.keys(summary.prVerdicts)).toHaveLength(2);
  });
});
