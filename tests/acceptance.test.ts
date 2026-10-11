import { describe, expect, it } from "vitest";
import { buildAcceptancePrompt, contractTotals, effectiveStatus } from "../src/server/acceptance.js";
import type { AcceptanceCriterion, PrDetail } from "../src/shared/types.js";

const criterion = (status: AcceptanceCriterion["status"], humanStatus?: AcceptanceCriterion["humanStatus"]): AcceptanceCriterion => ({
  id: status + (humanStatus ?? ""),
  text: "x",
  source: "pr-body",
  status,
  evidence: [],
  humanStatus
});

describe("acceptance contract", () => {
  it("lets the reviewer's verdict override the agent's", () => {
    expect(effectiveStatus(criterion("unproven", "proven"))).toBe("proven");
    expect(effectiveStatus(criterion("proven"))).toBe("proven");
  });

  it("totals criteria by effective status", () => {
    const totals = contractTotals({ criteria: [criterion("proven"), criterion("unproven"), criterion("failed", "proven"), criterion("not-applicable"), criterion("proven", "failed")] });
    expect(totals).toEqual({ total: 5, proven: 2, unproven: 1, failed: 1, notApplicable: 1 });
  });

  it("builds a prompt that carries issues, CI and checkout availability", () => {
    const detail = {
      repository: "acme/app",
      number: 7,
      title: "Add retry",
      body: "Retries 3 times.",
      baseRefName: "main",
      files: [{ path: "src/Retry.java", additions: 10, deletions: 0 }],
      linkedIssues: [{ number: 3, title: "Retry on timeout", url: "u", state: "OPEN", body: "Must retry 3 times with backoff." }],
      diff: "diff --git a/src/Retry.java b/src/Retry.java\n+retry"
    } as unknown as PrDetail;
    const prompt = buildAcceptancePrompt(detail, { analysisSummary: "s", testsToCheck: ["./gradlew test"], ciChecks: [{ name: "build", workflow: "ci", state: "SUCCESS", bucket: "pass", description: "", link: "", startedAt: "", completedAt: "", canFetchLog: false }], verificationJobs: [], hasCheckout: true });
    expect(prompt).toContain("Must retry 3 times with backoff.");
    expect(prompt).toContain('"name": "build"');
    expect(prompt).toContain("read-only checkout");
    expect(prompt).not.toContain("No checkout is available");
  });
});
