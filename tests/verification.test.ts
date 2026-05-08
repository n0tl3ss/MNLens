import { describe, expect, it } from "vitest";
import {
  closestGradleProject,
  explicitAnchorsFromAsciiDoc,
  htmlAnchorOffset,
  isAllowedExecutable,
  manualVerificationCommand,
  normalizeVerificationCommand,
  parseVerificationCommand
} from "../src/server/verification.js";

describe("verification command parsing", () => {
  it("extracts runnable commands from reviewer prose", () => {
    expect(normalizeVerificationCommand("Run `./gradlew :oraclecloud-logging:test --tests 'io.micronaut.*Spec'` and verify it passes.")).toBe(
      "./gradlew :oraclecloud-logging:test --tests 'io.micronaut.*Spec'"
    );
    expect(parseVerificationCommand("Run `./gradlew :oraclecloud-logging:test --tests 'io.micronaut.*Spec'` and verify it passes.")).toEqual({
      command: "./gradlew",
      args: [":oraclecloud-logging:test", "--tests", "io.micronaut.*Spec"],
      display: "./gradlew :oraclecloud-logging:test --tests io.micronaut.*Spec"
    });
  });

  it("rejects shell operators and unsupported executables", () => {
    expect(parseVerificationCommand("./gradlew test && rm -rf build")).toBeUndefined();
    expect(parseVerificationCommand("bash -c ./gradlew test")).toBeUndefined();
    expect(isAllowedExecutable("bash")).toBe(false);
    expect(isAllowedExecutable("./gradlew")).toBe(true);
  });

  it("maps generated Gradle project names to discovered project paths", () => {
    const projects = new Set([":micronaut-oraclecloud-logging", ":micronaut-oraclecloud-sdk", ":test-suite"]);
    expect(closestGradleProject(":oraclecloud-logging", projects)).toBe(":micronaut-oraclecloud-logging");
    expect(closestGradleProject(":micronaut-oraclecloud-sdk", projects)).toBe(":micronaut-oraclecloud-sdk");
    expect(closestGradleProject(":unknown", projects)).toBeUndefined();
  });

  it("formats manual verification command ids", () => {
    expect(manualVerificationCommand("docs-1")).toBe("codex-manual-check docs-1");
  });

  it("does not treat code snippet attributes as rendered docs anchors", () => {
    expect(explicitAnchorsFromAsciiDoc('<appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">')).toEqual([]);
    expect(explicitAnchorsFromAsciiDoc("[[logback-mdc]]\n[#mdc]\n[id=\"otelMdc\"]")).toEqual(["logback-mdc", "mdc", "otelMdc"]);
  });

  it("matches only real HTML id/name anchors, not escaped code snippets or links", () => {
    const html = `
      <a href="#mdc">Logback MDC</a>
      <code>&lt;appender name="CONSOLE"&gt;</code>
      <h2 id="mdc">Logback MDC</h2>
    `;
    expect(htmlAnchorOffset(html, "CONSOLE")).toBe(-1);
    expect(htmlAnchorOffset(html, "mdc")).toBeGreaterThan(0);
  });
});
