import { describe, expect, it } from "vitest";
import type { FixJob, Job, VerificationJob } from "../src/shared/types";
import { clearRecoveryPatch, interruptedJobPatch, parsePrKey } from "../src/server/recovery";

describe("job recovery helpers", () => {
  it("marks interrupted analysis jobs as resumable without losing existing metadata", () => {
    const job: Job = {
      id: "analysis-1",
      status: "running",
      prKey: "owner__repo__12",
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:01:00.000Z",
      error: "previous context"
    };

    const patch = interruptedJobPatch(job, "Analysis stopped.");

    expect(patch).toMatchObject({
      status: "failed",
      resumable: true,
      recoveryMessage: "Analysis stopped.",
      error: "Analysis stopped.\n\nprevious context"
    });
    expect(patch.interruptedAt).toBeTruthy();
  });

  it("preserves verification workspace fields through interrupted patches", () => {
    const job: VerificationJob = {
      id: "verification-1",
      status: "running",
      prKey: "owner__repo__12",
      command: "./gradlew test",
      repoDir: "/tmp/repo",
      phase: "running",
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:01:00.000Z",
      stdout: "partial output",
      stderr: ""
    };

    const recovered = { ...job, ...interruptedJobPatch(job, "Verification stopped.", { phase: "completed" }) };

    expect(recovered.repoDir).toBe("/tmp/repo");
    expect(recovered.stdout).toBe("partial output");
    expect(recovered.phase).toBe("completed");
    expect(recovered.resumable).toBe(true);
  });

  it("clears recovery metadata when a queued job is restarted", () => {
    const patch = clearRecoveryPatch<FixJob>();

    expect(patch).toEqual({
      interruptedAt: undefined,
      resumable: undefined,
      recoveryMessage: undefined
    });
  });

  it("parses persisted PR keys for queue recovery", () => {
    expect(parsePrKey("micronaut-projects__micronaut-tracing__839")).toEqual({
      owner: "micronaut-projects",
      repo: "micronaut-tracing",
      number: 839
    });
    expect(parsePrKey("broken")).toBeUndefined();
  });
});
