import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analysisJsonSchema, buildPrompt, extractJson, parseCodexOutput, readRepoGuidance, repoGuidancePromptBlock, rewriteGradleProjectPathsInText } from "../src/server/codex";
import type { PrDetail } from "../src/shared/types";

describe("codex output parsing", () => {
  it("extracts a JSON object from surrounding text", () => {
    expect(extractJson("log\n{\"type\":\"bug\"}\n")).toBe("{\"type\":\"bug\"}");
  });

  it("validates structured analysis output", () => {
    const parsed = parseCodexOutput(
      JSON.stringify({
        type: "feature",
        confidence: 0.82,
        summary: "Adds RabbitMQ instrumentation.",
        evidence: ["New instrumentation module"],
        reviewerFocus: ["Configuration names"],
        risks: ["Missing shutdown path"],
        testsToCheck: ["Integration test"],
        caveats: ["Check connection lifecycle"],
        draftComment: "Review looks focused on instrumentation behavior."
      })
    );
    expect(parsed.type).toBe("feature");
    // Analyses cached before the reading guide / assumptions / edge cases existed still parse.
    expect(parsed.readingGuide).toEqual([]);
    expect(parsed.assumptions).toEqual([]);
    expect(parsed.edgeCases).toEqual([]);
  });

  it("keeps the reading guide, assumptions and edge cases with their coverage", () => {
    const parsed = parseCodexOutput(
      JSON.stringify({
        type: "bug",
        confidence: 0.7,
        readingGuide: [{ path: "src/Tracker.java", lines: "120-148", title: "Where the origin is recorded", explanation: "Records every generated source.", whyItMatters: "This is the behavior change." }],
        assumptions: [{ title: "Generated sources depend on all inputs", observation: "Every Python-generated source is treated as aggregating.", perspective: "Single-origin sources may go stale.", recommendation: "grep for other generators", severity: "medium", location: "src/Tracker.java:141" }],
        edgeCases: [
          { title: "Provider no longer generated", observation: "All functional interfaces removed.", perspective: "Outputs should be deleted.", recommendation: "Add a deletion test.", severity: "high", location: "src/Tracker.java:130", covered: "no" },
          { title: "Bogus coverage value", observation: "x", perspective: "y", recommendation: "z", severity: "low", location: "", covered: "maybe" }
        ]
      })
    );
    expect(parsed.readingGuide[0]).toMatchObject({ path: "src/Tracker.java", lines: "120-148" });
    expect(parsed.assumptions[0]).toMatchObject({ location: "src/Tracker.java:141", severity: "medium" });
    expect(parsed.edgeCases[0].covered).toBe("no");
    expect(parsed.edgeCases[1].covered).toBe("unknown");
    const schema = analysisJsonSchema() as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(expect.arrayContaining(["readingGuide", "assumptions", "edgeCases", "inspectedFiles"]));
    expect(parsed.inspectedFiles).toEqual([]);
  });

  it("asks for the reading guide, assumptions and edge cases, and switches to self-review for the author", () => {
    const detail = {
      key: "o__r__1",
      owner: "o",
      repo: "r",
      number: 1,
      title: "t",
      body: "",
      url: "",
      repository: "o/r",
      author: "me",
      labels: [],
      queues: [],
      state: "OPEN",
      isDraft: false,
      createdAt: "",
      updatedAt: "",
      commentsCount: 0,
      linkedIssues: [],
      baseRefName: "main",
      headRefName: "x",
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      reviewers: [],
      files: [],
      commits: [],
      conversationComments: [],
      reviewSummaries: [],
      reviewComments: [],
      diff: "diff --git a/a b/a",
      diffHash: "h"
    } as unknown as PrDetail;
    const prompt = buildPrompt(detail, undefined, { reviewerIsAuthor: true, hasCheckout: true });
    expect(prompt).toContain("readingGuide:");
    expect(prompt).toContain("assumptions:");
    expect(prompt).toContain("edgeCases:");
    expect(prompt).toContain("The reviewer is the PR author");
    expect(prompt).toContain("read-only checkout of the PR");
    expect(prompt).toContain("inspectedFiles");
    expect(buildPrompt(detail)).not.toContain("The reviewer is the PR author");
    expect(buildPrompt(detail)).not.toContain("read-only checkout of the PR");
  });
});

describe("repository guidance", () => {
  it("reads the maintainers' agent and contributor guidance from the checkout, bounded in size", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mnlens-guidance-"));
    await writeFile(join(dir, "CLAUDE.md"), "# Project\nRun tests with ./gradlew check.");
    await mkdir(join(dir, ".github", "instructions"), { recursive: true });
    await writeFile(join(dir, ".github", "instructions", "coding.instructions.md"), "x".repeat(4000));
    await writeFile(join(dir, ".github", "instructions", "notes.txt"), "ignored");
    const guidance = await readRepoGuidance(dir, { perFile: 100, total: 1000 });
    expect(guidance.map((item) => item.path)).toEqual(["CLAUDE.md", ".github/instructions/coding.instructions.md"]);
    expect(guidance[1].excerpt.endsWith("[truncated]")).toBe(true);
    expect(guidance[1].excerpt.length).toBeLessThan(130);
    const block = repoGuidancePromptBlock(guidance);
    expect(block).toContain("--- CLAUDE.md ---");
    expect(block).toContain("./gradlew check");
    expect(repoGuidancePromptBlock([])).toBe("");
    expect(await readRepoGuidance(undefined)).toEqual([]);
  });
});

describe("Gradle test command normalization", () => {
  it("rewrites settings include names to resolved Gradle project names", () => {
    const item =
      "Run module tests for the changed logging package: `./gradlew :oraclecloud-logging:test --tests 'io.micronaut.oraclecloud.logging.*Spec'`. The `:oraclecloud-logging` project path is present in `settings.gradle.kts`.";
    const corrected = rewriteGradleProjectPathsInText(item, new Set([":micronaut-oraclecloud-logging", ":micronaut-oraclecloud-bom"]));
    expect(corrected).toContain("./gradlew :micronaut-oraclecloud-logging:test");
    expect(corrected).toContain("MNLens verified the runnable Gradle project path as `:micronaut-oraclecloud-logging` via `./gradlew projects`.");
    expect(corrected).not.toContain(":oraclecloud-logging:test");
    expect(corrected).not.toContain("project path is present in `settings.gradle.kts`");
  });

  it("rewrites Gradle commands embedded later in review text", () => {
    const item =
      "Before merge, please show rendered docs output and run `./gradlew :oraclecloud-logging:test --tests 'io.micronaut.oraclecloud.logging.*Spec'`.";
    const corrected = rewriteGradleProjectPathsInText(item, new Set([":micronaut-oraclecloud-logging"]));
    expect(corrected).toContain("./gradlew :micronaut-oraclecloud-logging:test");
    expect(corrected).toContain("MNLens verified the runnable Gradle project path");
  });
});
