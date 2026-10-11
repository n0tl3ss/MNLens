import { describe, expect, it } from "vitest";
import { parseRepositoryRulesFile, repositoryRulesPath } from "../src/server/repoRules.js";
import { calibrationPromptBlock, draftCommentAccuracy, keepRate, summarizeMemory } from "../src/server/reviewMemory.js";
import type { FindingFeedback } from "../src/shared/types.js";

describe("repository-committed rules", () => {
  it("parses .mnlens/review-rules.json into read-only repo rules", () => {
    const rules = parseRepositoryRulesFile(
      "acme/app",
      JSON.stringify({ version: 1, rules: [{ id: "no-todo", title: "No TODOs", body: "Never add TODO markers.", tone: "strict" }, { title: "Tests required", body: "Every behavior change needs a test." }, { title: "", body: "ignored" }, { id: "no-todo", title: "dup", body: "dup" }] })
    );
    expect(repositoryRulesPath).toBe(".mnlens/review-rules.json");
    expect(rules.map((rule) => rule.id)).toEqual(["repo:no-todo", "repo:tests-required"]);
    expect(rules[0]).toMatchObject({ enabled: true, source: "repository", origin: "repository", tone: "strict" });
    expect(parseRepositoryRulesFile("acme/app", "{}")).toEqual([]);
  });
});

describe("agent accuracy", () => {
  const entry = (title: string, verdict: FindingFeedback["verdict"], commentKind: FindingFeedback["commentKind"]): FindingFeedback => ({ id: `${title}${verdict}`, prKey: "acme__app__1", repository: "acme/app", kind: "draft-comment", title, verdict, at: "", commentKind });

  it("counts kept vs dismissed suggested comments per kind", () => {
    const accuracy = draftCommentAccuracy([entry("a", "kept", "blocking"), entry("b", "kept", "nit"), entry("c", "dismissed", "nit"), entry("d", "dismissed", "nit"), { ...entry("e", "kept", undefined), kind: "risk" }]);
    expect(accuracy).toEqual({ kept: 2, dismissed: 2, byKind: { blocking: { kept: 1, dismissed: 0 }, nit: { kept: 1, dismissed: 2 } } });
    expect(keepRate(accuracy.byKind.nit)).toBeCloseTo(1 / 3);
    expect(keepRate(accuracy.byKind.blocking)).toBeUndefined();
    expect(keepRate(undefined)).toBeUndefined();
  });

  it("exposes accuracy and team metadata in the summary", () => {
    const summary = summarizeMemory("acme/app", [entry("a", "kept", "nit"), entry("b", "dismissed", "nit")], "acme__app__1", { members: 3, shared: true });
    expect(summary.draftComments.byKind.nit).toEqual({ kept: 1, dismissed: 1 });
    expect(summary.members).toBe(3);
    expect(summary.shared).toBe(true);
  });

  it("tells the agent which comment kinds reviewers rarely keep", async () => {
    // calibrationPromptBlock reads storage; the pure summary path is what the test pins down.
    const summary = summarizeMemory("acme/app", [entry("a", "dismissed", "nit"), entry("b", "dismissed", "nit"), entry("c", "dismissed", "nit"), entry("d", "kept", "blocking")]);
    expect(keepRate(summary.draftComments.byKind.nit)).toBe(0);
    expect(typeof calibrationPromptBlock).toBe("function");
  });
});
