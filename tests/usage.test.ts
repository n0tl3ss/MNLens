import { describe, expect, it } from "vitest";
import { summarizeUsage } from "../src/server/usage.js";

describe("usage ledger summary", () => {
  it("totals cost only for runs that reported it and groups by task and agent", () => {
    const summary = summarizeUsage([
      { at: "", prKey: "k", task: "deep-analysis", agent: "claude", model: "sonnet", tier: "standard", durationMs: 60_000, costUsd: 0.21, ok: true },
      { at: "", prKey: "k", task: "quick-answer", agent: "claude", model: "haiku", tier: "economy", durationMs: 5_000, costUsd: 0.004, ok: true },
      { at: "", prKey: "k", task: "fix-implementation", agent: "codex", model: "gpt-6.1-sol", tier: "standard", durationMs: 300_000, ok: true }
    ], "k");
    expect(summary.runs).toBe(3);
    expect(summary.runsWithCost).toBe(2);
    expect(summary.totalCostUsd).toBeCloseTo(0.214, 3);
    expect(summary.byAgent.codex?.runs).toBe(1);
    expect(summary.byTask["deep-analysis"]?.costUsd).toBeCloseTo(0.21, 3);
    expect(summary.totalDurationMs).toBe(365_000);
  });
});
