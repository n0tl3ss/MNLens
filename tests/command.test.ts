import { describe, expect, it } from "vitest";
import { runCommand } from "../src/server/command.js";

describe("command runner", () => {
  it("fails timed out commands with a clear timeout message", async () => {
    await expect(
      runCommand(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
        timeoutMs: 20
      })
    ).rejects.toThrow(/timed out after 20ms/);
  });
});
