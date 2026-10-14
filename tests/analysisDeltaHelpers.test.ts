import { describe, expect, it } from "vitest";
import { deltaSummary, deltaTone, sortDeltaItems } from "../src/client/src/analysisDeltaHelpers";
import type { AnalysisDelta } from "../src/shared/types";

const delta: AnalysisDelta = {
  previousGeneratedAt: "2026-10-01T10:00:00.000Z",
  previousDiffHash: "abcdef0123456789",
  resolved: [{ kind: "risk", title: "Unbounded cache growth", observation: "", severity: "low" }],
  persisting: [
    { kind: "risk", title: "Missing null check", observation: "", severity: "high", matchedBy: "title", previousSeverity: "medium" },
    { kind: "focus", title: "Config migration path", observation: "", severity: "medium", matchedBy: "title" }
  ],
  added: [
    { kind: "edge-case", title: "Empty pool list", observation: "", severity: "low", location: "src/pool.ts:12" },
    { kind: "risk", title: "Secrets logged at debug level", observation: "", severity: "high" }
  ],
  carriedVerdicts: 1
};

describe("analysis delta helpers", () => {
  it("summarizes counts, severity changes and carried verdicts", () => {
    expect(deltaSummary(delta)).toBe("1 resolved · 2 new · 2 persisting (1 changed severity) · 1 verdict carried over");
    expect(deltaTone(delta)).toBe("danger");
    expect(deltaTone({ ...delta, added: [delta.added[0]] })).toBe("queue");
    expect(deltaTone({ ...delta, added: [] })).toBe("added");
    expect(deltaTone({ ...delta, added: [], resolved: [] })).toBe("neutral");
    expect(sortDeltaItems(delta.added).map((item) => item.title)).toEqual(["Secrets logged at debug level", "Empty pool list"]);
  });
});
