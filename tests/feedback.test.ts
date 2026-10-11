import { describe, expect, it } from "vitest";
import { buildFeedbackComment } from "../src/server/feedback.js";
import type { AcceptanceContract, AnalysisResult, PrDetail, ReviewMemorySummary } from "../src/shared/types.js";

describe("author feedback comment", () => {
  it("renders the acceptance table, keeps only non-dismissed findings, and lists verification", () => {
    const detail = { number: 12 } as PrDetail;
    const analysis = {
      riskDetails: [
        { title: "Retry loop can spin", observation: "No backoff cap.", perspective: "", recommendation: "Cap at 5.", severity: "high" },
        { title: "Style nit", observation: "Naming.", perspective: "", recommendation: "", severity: "low" }
      ],
      reviewerFocusDetails: [],
      testAssessment: { rating: "partial", summary: "", covered: [], gaps: ["No timeout test"], recommendedTests: [] }
    } as unknown as AnalysisResult;
    const contract = {
      criteria: [
        { id: "a", text: "Retries 3 times", source: "linked-issue", origin: "#3", status: "proven", evidence: [{ kind: "test", ref: "RetrySpec.retriesThreeTimes" }] },
        { id: "b", text: "Backoff is exponential", source: "linked-issue", origin: "#3", status: "unproven", evidence: [], note: "Add a timing test." }
      ]
    } as unknown as AcceptanceContract;
    const memory = { prVerdicts: { "risk:style nit": "dismissed" } } as unknown as ReviewMemorySummary;
    const preview = buildFeedbackComment({
      detail,
      analysis,
      contract,
      memory,
      verificationJobs: [{ id: "v", status: "done", prKey: "k", command: "./gradlew test", createdAt: "", updatedAt: "", stdout: "", stderr: "", durationMs: 42_000 }],
      reviewerNote: "Looks close."
    });
    expect(preview.sections).toEqual(["note", "acceptance", "findings", "verification", "tests"]);
    expect(preview.body).toContain("1/2 proven");
    expect(preview.body).toContain("`RetrySpec.retriesThreeTimes`");
    expect(preview.body).toContain("Backoff is exponential — Add a timing test.");
    expect(preview.body).toContain("Retry loop can spin");
    expect(preview.body).not.toContain("Style nit");
    expect(preview.body).toContain("✅ `./gradlew test` (42s)");
  });
});
