import { describe, expect, it } from "vitest";
import type { CiCheck, VerificationJob } from "../src/shared/types";
import {
  ciCoverageForCommand,
  ciSummary,
  cleanConsoleOutput,
  commandKey,
  extractRunnableCommand,
  isAutomationVerificationCandidate,
  isGenuineManualVerification,
  manualCheckId,
  sortVerificationItems,
  toneForCi
} from "../src/client/src/verificationHelpers";

const now = "2026-05-08T10:00:00.000Z";

function check(overrides: Partial<CiCheck>): CiCheck {
  return {
    name: "build",
    workflow: "build",
    state: "SUCCESS",
    bucket: "pass",
    description: "",
    link: "",
    startedAt: now,
    completedAt: now,
    canFetchLog: true,
    ...overrides
  };
}

function job(overrides: Partial<VerificationJob>): VerificationJob {
  return {
    id: "verification-1",
    prKey: "example__repo__1",
    command: "./gradlew test",
    status: "done",
    createdAt: now,
    updatedAt: now,
    stdout: "",
    stderr: "",
    ...overrides
  };
}

describe("verification helpers", () => {
  it("extracts runnable commands from markdown text", () => {
    expect(extractRunnableCommand("Run `./gradlew :module:test --tests '*Spec'` and verify output.")).toBe("./gradlew :module:test --tests '*Spec'");
    expect(extractRunnableCommand("```bash\nnpm test\n```")).toBe("npm test");
  });

  it("normalizes command keys and strips console escapes", () => {
    expect(commandKey("`./gradlew test`.")).toBe("./gradlew test");
    expect(cleanConsoleOutput("\u001b[31mFAIL\u001b[0m")).toBe("FAIL");
  });

  it("summarizes CI state and matches likely command coverage", () => {
    const checks = [check({ name: "module test", workflow: "gradle", state: "FAILURE", bucket: "fail" })];
    expect(ciSummary(checks)).toEqual({ label: "failing", tone: "danger" });
    expect(toneForCi(checks[0])).toBe("danger");
    expect(ciCoverageForCommand("./gradlew :module:test", checks)?.label).toBe("FAILURE in general CI");
  });

  it("prioritizes failed verification work before not-yet-run checks", () => {
    const items = ["Run `./gradlew test`", "Manual verification: confirm cloud metrics."];
    const sorted = sortVerificationItems(items, [job({ status: "failed", command: "./gradlew test", error: "boom" })]);

    expect(sorted[0].item).toBe(items[0]);
    expect(manualCheckId(items[1], 1)).toMatch(/^manual:1:/);
  });

  it("distinguishes real manual checks from automation candidates", () => {
    expect(isGenuineManualVerification("Manual verification: check this in an OCI account with credentials.")).toBe(true);
    expect(isAutomationVerificationCandidate("Add/run automated lifecycle regression test.")).toBe(true);
  });
});
