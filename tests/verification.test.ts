import { describe, expect, it } from "vitest";
import {
  closestGradleProject,
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
});
