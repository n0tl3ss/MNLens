import { describe, expect, it } from "vitest";
import { extractJson, parseCodexOutput, rewriteGradleProjectPathsInText } from "../src/server/codex";

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
        docs: [{ title: "RabbitMQ docs", url: "https://www.rabbitmq.com/", reason: "Feature docs" }],
        similarImplementations: [],
        caveats: ["Check connection lifecycle"],
        draftComment: "Review looks focused on instrumentation behavior."
      })
    );
    expect(parsed.type).toBe("feature");
    expect(parsed.docs[0].url).toContain("rabbitmq");
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
