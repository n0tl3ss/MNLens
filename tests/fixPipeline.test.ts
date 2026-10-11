import { describe, expect, it } from "vitest";
import { extractFixAnswer, extractQaSummary, parsePipelineDirective, pipelineReworkTarget } from "../src/server/fix.js";

describe("fix pipeline control markers", () => {
  it("reads the last pipeline directive in agent output", () => {
    expect(parsePipelineDirective("notes\nPRA_PIPELINE: continue")).toEqual({ action: "continue" });
    expect(parsePipelineDirective("PRA_PIPELINE: continue\nlater: PRA_PIPELINE: rework implementation")).toEqual({ action: "rework", target: "implementation" });
    expect(parsePipelineDirective("PRA_PIPELINE: rework nonsense")).toBeUndefined();
    expect(parsePipelineDirective("no marker")).toBeUndefined();
  });

  it("only allows rework toward earlier phases within the budget", () => {
    expect(pipelineReworkTarget("implementation", "tests-qa", 0)?.phase).toBe("implementation");
    expect(pipelineReworkTarget("tests-qa", "implementation", 0)).toBeUndefined();
    expect(pipelineReworkTarget("implementation", "implementation", 0)).toBeUndefined();
    expect(pipelineReworkTarget("implementation", "final-review", 2)).toBeUndefined();
    expect(pipelineReworkTarget(undefined, "docs", 0)).toBeUndefined();
  });

  it("extracts QA summaries and falls back to the directive", () => {
    expect(extractQaSummary("QA_VERIFICATION_SUMMARY: flaky network test\nPRA_PIPELINE: continue", ["x"], { action: "continue" })).toBe("flaky network test");
    expect(extractQaSummary("no marker", ["Gradle failed"], { action: "rework", target: "implementation" })).toContain("Implementation rework");
    expect(extractQaSummary("no marker", ["Gradle failed"], { action: "rework", target: "implementation" })).toContain("Gradle failed");
  });

  it("strips the FIX_ANSWER marker", () => {
    expect(extractFixAnswer("thinking...\nFIX_ANSWER: The null check is in place.")).toBe("The null check is in place.");
    expect(extractFixAnswer("plain answer")).toBe("plain answer");
  });
});
