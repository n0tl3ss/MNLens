import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { askFixQuestion } from "../src/server/fix.js";
import { writeFixJob } from "../src/server/cache.js";
import type { FixJob } from "../src/shared/types.js";

describe("fix session lifecycle", () => {
  it("queues reviewer guidance while a fix session is running", async () => {
    const now = new Date().toISOString();
    const job: FixJob = {
      id: `test-${randomUUID()}`,
      status: "running",
      prKey: "owner__repo__1",
      phase: "implementation",
      statusMessage: "Implementation is running.",
      instructions: "Existing guidance.",
      createdAt: now,
      updatedAt: now,
      stdout: "",
      stderr: ""
    };
    await writeFixJob(job);

    const response = await askFixQuestion(job.id, "Also cover the shutdown edge case.");

    expect(response.answer).toContain("Guidance queued");
    expect(response.job.status).toBe("running");
    expect(response.job.instructions).toContain("Existing guidance.");
    expect(response.job.instructions).toContain("Also cover the shutdown edge case.");
    expect(response.job.conversation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", body: "Also cover the shutdown edge case." }),
        expect.objectContaining({ role: "assistant", body: expect.stringContaining("Guidance queued") })
      ])
    );
  });
});
