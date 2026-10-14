import { describe, expect, it } from "vitest";
import { annotateDiff, parseDiffLines, resolveAnchor } from "../src/shared/diffLines.js";
import { buildReviewDraftPrompt, kindRank, normalizeComments, reviewDraftJsonSchema } from "../src/server/reviewDraft.js";
import { buildReviewDraftPrompt } from "../src/server/reviewDraft.js";
import type { PrDetail } from "../src/shared/types.js";

const diff = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,4 +10,5 @@ export function run() {
   const a = 1;
-  const b = legacy();
+  const b = modern();
+  const c = extra();
   return a + b;
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,2 +1,2 @@
-# Old
+# New
 text
`;

describe("diff line mapping", () => {
  it("assigns GitHub-style side/line numbers per file", () => {
    const refs = parseDiffLines(diff);
    expect(refs.find((ref) => ref.text.includes("legacy()"))).toMatchObject({ path: "src/app.ts", side: "LEFT", line: 11, kind: "-" });
    expect(refs.find((ref) => ref.text.includes("modern()"))).toMatchObject({ path: "src/app.ts", side: "RIGHT", line: 11, kind: "+" });
    expect(refs.find((ref) => ref.text.includes("extra()"))).toMatchObject({ path: "src/app.ts", side: "RIGHT", line: 12, kind: "+" });
    expect(refs.find((ref) => ref.text.includes("return a + b"))).toMatchObject({ side: "RIGHT", line: 13, kind: " " });
    expect(refs.find((ref) => ref.text.includes("# New"))).toMatchObject({ path: "README.md", side: "RIGHT", line: 1 });
  });

  it("annotates the diff with quotable anchors and lists files", () => {
    const annotated = annotateDiff(diff);
    expect(annotated.files).toEqual(["src/app.ts", "README.md"]);
    expect(annotated.text).toMatch(/src\/app\.ts R11 \+\s+const b = modern\(\);/);
    expect(annotated.text).toMatch(/src\/app\.ts L11 -\s+const b = legacy\(\);/);
    expect(annotated.anchors.has("README.md|RIGHT|3")).toBe(false);
    expect(annotated.anchors.has("src/app.ts|RIGHT|12")).toBe(true);
    expect(annotated.anchors.has("src/app.ts|RIGHT|99")).toBe(false);
  });

  it("validates anchors, snaps near misses, and flags the rest", () => {
    const annotated = annotateDiff(diff);
    expect(resolveAnchor(annotated, { path: "b/src/app.ts", side: "RIGHT", line: 11 })).toEqual({ path: "src/app.ts", side: "RIGHT", line: 11, unanchored: false });
    expect(resolveAnchor(annotated, { path: "src/app.ts", side: "LEFT", line: 11 })).toMatchObject({ side: "LEFT", line: 11, unanchored: false });
    // Off by one on the new side snaps to the nearest added line.
    expect(resolveAnchor(annotated, { path: "src/app.ts", side: "RIGHT", line: 14 })).toMatchObject({ line: 12, unanchored: false });
    expect(resolveAnchor(annotated, { path: "src/app.ts", side: "RIGHT", line: 40 })).toMatchObject({ line: undefined, unanchored: true });
    expect(resolveAnchor(annotated, { path: "src/missing.ts", side: "RIGHT", line: 1 })).toMatchObject({ unanchored: true });
    expect(resolveAnchor(annotated, { path: "src/app.ts" })).toMatchObject({ unanchored: true });
  });
});

describe("review draft", () => {
  it("normalizes comments: anchors, dedupe, ordering by kind", () => {
    const annotated = annotateDiff(diff);
    const comments = normalizeComments(
      [
        { path: "src/app.ts", side: "RIGHT", line: 12, kind: "nit", title: "", body: "Rename c.", rationale: "", criterion: null },
        { path: "src/app.ts", side: "RIGHT", line: 11, kind: "blocking", title: "modern() throws", body: "modern() can throw; wrap it.", rationale: "see diff", criterion: "Retries 3 times" },
        { path: "src/app.ts", side: "RIGHT", line: 11, kind: "blocking", title: "dup", body: "modern() can throw; wrap it.", rationale: "", criterion: null },
        { path: "src/app.ts", side: "RIGHT", line: 500, kind: "question", title: "Why?", body: "Why drop legacy()?", rationale: "", criterion: null },
        { path: "", side: "RIGHT", line: 1, kind: "praise", title: "", body: "ignored: no path", rationale: "", criterion: null },
        { path: "README.md", side: "RIGHT", line: 1, kind: "praise", title: "", body: "", rationale: "", criterion: null }
      ],
      annotated
    );
    expect(comments.map((comment) => comment.kind)).toEqual(["blocking", "question", "nit"]);
    expect(comments[0]).toMatchObject({ path: "src/app.ts", line: 11, side: "RIGHT", criterion: "Retries 3 times", title: "modern() throws" });
    expect(comments[0].unanchored).toBeUndefined();
    expect(comments[1]).toMatchObject({ unanchored: true, line: undefined });
    expect(comments[2].title).toBe("Rename c.");
    expect(new Set(comments.map((comment) => comment.id)).size).toBe(3);
  });

  it("keeps one-line suggestions only for resolved RIGHT-side anchors and renders them as GitHub suggestion blocks", async () => {
    const annotated = annotateDiff(diff);
    const comments = normalizeComments(
      [
        { path: "src/app.ts", side: "RIGHT", line: 11, kind: "nit", title: "Typo", body: "Typo in the call.", rationale: "", criterion: null, suggestion: "  const b = modern();   " },
        { path: "src/app.ts", side: "RIGHT", line: 500, kind: "nit", title: "Unanchored", body: "Cannot place.", rationale: "", criterion: null, suggestion: "x" },
        { path: "src/app.ts", side: "RIGHT", line: 12, kind: "nit", title: "No suggestion", body: "Just prose.", rationale: "", criterion: null, suggestion: "   " }
      ],
      annotated
    );
    expect(comments.find((comment) => comment.title === "Typo")?.suggestion).toBe("  const b = modern();");
    expect(comments.find((comment) => comment.title === "Unanchored")?.suggestion).toBeUndefined();
    expect(comments.find((comment) => comment.title === "No suggestion")?.suggestion).toBeUndefined();
    const { commentBodyWithSuggestion } = await import("../src/shared/suggestions");
    expect(commentBodyWithSuggestion("Typo in the call.", "  const b = modern();")).toBe("Typo in the call.\n\n```suggestion\n  const b = modern();\n```");
    expect(commentBodyWithSuggestion("Just prose.", undefined)).toBe("Just prose.");
    expect((reviewDraftJsonSchema() as { properties: { comments: { items: { required: string[] } } } }).properties.comments.items.required).toContain("suggestion");
  });

  it("ranks blocking before praise", () => {
    expect(kindRank("blocking")).toBeLessThan(kindRank("important"));
    expect(kindRank("nit")).toBeLessThan(kindRank("praise"));
  });

  it("publishes a strict schema the agents can be constrained with", () => {
    const schema = reviewDraftJsonSchema() as { required: string[]; properties: Record<string, { items?: { required?: string[] } }> };
    expect(schema.required).toEqual(["decision", "decisionRationale", "finalComment", "comments", "mustDo", "shouldDo", "optional"]);
    expect(schema.properties.comments.items?.required).toContain("line");
  });

  it("builds a prompt with the annotated diff, prior analysis, acceptance status and rules", () => {
    const detail = {
      key: "acme__app__7",
      repository: "acme/app",
      number: 7,
      title: "Modernize",
      author: "dev",
      body: "Switch to modern()",
      baseRefName: "main",
      isDraft: false,
      files: [{ path: "src/app.ts", additions: 2, deletions: 1 }],
      linkedIssues: [],
      reviewComments: [{ id: 1, author: "bob", url: "", body: "Already asked about naming", createdAt: "", path: "src/app.ts", line: 12, side: "RIGHT", isResolved: false }],
      diff
    } as unknown as PrDetail;
    const annotated = annotateDiff(diff);
    const prompt = buildReviewDraftPrompt(detail, annotated, {
      analysis: { summary: "Replaces legacy() with modern().", reviewerFocus: ["error handling"], risks: [], caveats: [], type: "improvement", confidence: 0.8 } as never,
      acceptance: { criteria: [{ id: "1", text: "Retries 3 times", source: "pr-body", status: "unproven", humanStatus: "proven", evidence: [{ kind: "test", ref: "RetryTest" }] }] } as never,
      repoRules: ["No TODOs: comments must not add TODO markers"],
      calibration: "Reviewer calibration: nits about naming were dismissed 3 times."
    });
    expect(prompt).toMatch(/src\/app\.ts R11 \+\s+const b = modern\(\);/);
    expect(prompt).toContain("Replaces legacy() with modern().");
    expect(prompt).toContain('"status": "proven"');
    expect(prompt).toContain('"humanOverride": true');
    expect(prompt).toContain("No TODOs");
    expect(prompt).toContain("Reviewer calibration");
    expect(prompt).toContain("Already asked about naming");
    expect(prompt).toContain("Return only JSON");
  });
});

describe("review draft prompt", () => {
  it("tells the agent which commands already ran locally so it cites them instead of assigning them", () => {
    const detail = { repository: "acme/app", number: 1, title: "t", author: "a", body: "", baseRefName: "main", isDraft: false, files: [], linkedIssues: [], reviewComments: [] } as unknown as Parameters<typeof buildReviewDraftPrompt>[0];
    const job = { id: "v1", status: "done", prKey: "acme__app__1", command: "./gradlew :core:test --tests *FooSpec", createdAt: "", updatedAt: "", stdout: "", stderr: "", exitCode: 0, outcome: "passed", completedAt: "2026-10-14T13:43:00.000Z" } as const;
    const prompt = buildReviewDraftPrompt(detail, { text: "", files: [] }, { repoRules: [], calibration: "", verificationJobs: [job] });
    expect(prompt).toContain("Local verification runs MNLens already executed");
    expect(prompt).toContain("./gradlew :core:test --tests *FooSpec");
    expect(prompt).toContain('"outcome": "passed"');
    expect(buildReviewDraftPrompt(detail, { text: "", files: [] }, { repoRules: [], calibration: "" })).not.toContain("Local verification runs");
  });
});
