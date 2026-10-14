import { describe, expect, it } from "vitest";
import { acceptanceCommands, buildAcceptancePrompt, contractTotals, effectiveStatus } from "../src/server/acceptance.js";
import type { AcceptanceCriterion, PrDetail, VerificationJob } from "../src/shared/types.js";

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
    expect(totals).toMatchObject({ total: 5, proven: 2, unproven: 1, failed: 1, notApplicable: 1, ran: 0, running: 0 });
  });

  it("lets a failed local run fail the criterion and counts green runs only for proven criteria", () => {
    const job = (id: string, status: VerificationJob["status"], exitCode: number | null): VerificationJob => ({ id, status, prKey: "k", command: "./gradlew test", createdAt: "", updatedAt: "", stdout: "", stderr: "", exitCode });
    const withRun = (status: AcceptanceCriterion["status"], jobId: string): AcceptanceCriterion => ({ ...criterion(status), id: `${status}:${jobId}`, command: "./gradlew test", verification: { jobId, command: "./gradlew test", startedAt: "" } });
    const jobs = [job("green", "done", 0), job("red", "failed", 1), job("busy", "running", null)];
    expect(effectiveStatus(withRun("proven", "red"), jobs)).toBe("failed");
    expect(effectiveStatus(withRun("proven", "green"), jobs)).toBe("proven");
    expect(effectiveStatus(withRun("unproven", "green"), jobs)).toBe("unproven");
    expect(effectiveStatus({ ...withRun("proven", "red"), humanStatus: "proven" }, jobs)).toBe("proven");
    const totals = contractTotals({ criteria: [withRun("proven", "green"), withRun("unproven", "green"), withRun("proven", "red"), withRun("proven", "busy")] }, jobs);
    expect(totals).toMatchObject({ proven: 2, failed: 1, unproven: 1, ran: 1, running: 1 });
  });

  it("collects at most three distinct runnable commands from the contract", () => {
    const withCommand = (command: string): AcceptanceCriterion => ({ ...criterion("proven"), id: command, command });
    expect(acceptanceCommands({ criteria: [withCommand("./gradlew :a:test"), withCommand("`./gradlew :a:test`"), withCommand("rm -rf /"), withCommand("./gradlew :b:test"), withCommand("npm test"), withCommand("./gradlew :c:test")] })).toEqual(["./gradlew :a:test", "./gradlew :b:test", "npm test"]);
    expect(acceptanceCommands({ criteria: [criterion("proven")] })).toEqual([]);
  });

  it("ignores runs that never started and lets a newer run of the same command replace the attached one", () => {
    const job = (id: string, patch: Partial<VerificationJob>): VerificationJob => ({ id, status: "failed", prKey: "k", command: "./gradlew :a:test --tests '*FooSpec'", createdAt: "2026-10-14T10:00:00.000Z", updatedAt: "", stdout: "", stderr: "", exitCode: 1, ...patch });
    const proven = { ...criterion("proven"), command: "./gradlew :a:test --tests '*FooSpec'", verification: { jobId: "blocked-1", command: "./gradlew :a:test --tests *FooSpec", startedAt: "" } };
    const blocked = job("blocked-1", { outcome: "blocked", blockedReason: "the build needs JDK 25 and ran on JDK 21" });
    expect(effectiveStatus(proven, [blocked])).toBe("proven");
    expect(contractTotals({ criteria: [proven] }, [blocked])).toMatchObject({ proven: 1, failed: 0, blocked: 1, ran: 0 });
    // "Run again" starts a new job for the same command; the newest run speaks for the criterion.
    const rerun = job("rerun-1", { status: "done", exitCode: 0, outcome: "passed", createdAt: "2026-10-14T11:00:00.000Z" });
    expect(contractTotals({ criteria: [proven] }, [blocked, rerun])).toMatchObject({ proven: 1, blocked: 0, ran: 1 });
    const redRerun = job("rerun-2", { outcome: "test-failed", createdAt: "2026-10-14T12:00:00.000Z" });
    expect(effectiveStatus(proven, [blocked, rerun, redRerun])).toBe("failed");
    // A criterion without an attached job still picks up a run of its command (started from Tests To Check).
    expect(contractTotals({ criteria: [{ ...proven, verification: undefined }] }, [rerun])).toMatchObject({ ran: 1 });
  });

  it("upgrades an unproven criterion to proven when its named test ran green, but not without a named test", () => {
    const green: VerificationJob = { id: "g", status: "done", prKey: "k", command: "./gradlew :a:test --tests '*FooSpec'", createdAt: "2026-10-14T10:00:00.000Z", updatedAt: "", stdout: "", stderr: "", exitCode: 0, outcome: "passed" };
    const withTest = { ...criterion("unproven"), command: "./gradlew :a:test --tests '*FooSpec'", evidence: [{ kind: "test" as const, ref: "FooSpec: it does the thing" }] };
    const withoutTest = { ...withTest, evidence: [{ kind: "file" as const, ref: "src/Foo.java:12" }] };
    expect(effectiveStatus(withTest, [green])).toBe("proven");
    expect(effectiveStatus(withoutTest, [green])).toBe("unproven");
    expect(contractTotals({ criteria: [withTest] }, [green])).toMatchObject({ proven: 1, unproven: 0, ran: 1 });
  });

  it("skips a test command whose filters another command already covers", () => {
    const withCommand = (command: string): AcceptanceCriterion => ({ ...criterion("proven"), id: command, command });
    const criteria = [withCommand("./gradlew :core:test --tests '*TimedSpec'"), withCommand("./gradlew :core:test --tests '*TimedSpec' --tests '*CountedSpec'"), withCommand("./gradlew :kotlin:test"), withCommand("./gradlew :core:test --tests '*OtherSpec'")];
    expect(acceptanceCommands({ criteria })).toEqual(["./gradlew :core:test --tests *TimedSpec --tests *CountedSpec", "./gradlew :kotlin:test", "./gradlew :core:test --tests *OtherSpec"]);
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
    expect(prompt).toContain('"command"');
    expect(prompt).not.toContain("No checkout is available");
  });
});
