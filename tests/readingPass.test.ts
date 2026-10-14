import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filesReadFromTranscript, parseFilesReadList, resolveReadPaths, stripFilesReadList } from "../src/server/readingPass";

async function checkout(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mnlens-reading-"));
  await mkdir(join(dir, "src", "main"), { recursive: true });
  await mkdir(join(dir, "src", "test"), { recursive: true });
  await writeFile(join(dir, "src", "main", "Timed.java"), "class Timed {}");
  await writeFile(join(dir, "src", "main", "Cache.java"), "class Cache {}");
  await writeFile(join(dir, "src", "test", "TimedSpec.groovy"), "class TimedSpec {}");
  await writeFile(join(dir, "README.md"), "# r");
  return dir;
}

describe("reading pass: files the agent opened", () => {
  it("collects Read, Grep and Bash paths from a Claude stream-json transcript, skipping calls that failed", () => {
    const line = (content: unknown[]) => JSON.stringify({ type: "assistant", message: { content } });
    const result = (id: string, content: string, isError = false) => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } });
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
      line([{ type: "text", text: "Reading" }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/repo/src/main/Timed.java" } }]),
      result("t1", "class Timed {}"),
      line([{ type: "tool_use", id: "t2", name: "Grep", input: { pattern: "finish", path: "src/main/Cache.java" } }]),
      result("t2", "<tool_use_error>Error: No such tool available: Grep.</tool_use_error>"),
      line([{ type: "tool_use", id: "t3", name: "Bash", input: { command: "git show HEAD:src/test/TimedSpec.groovy | head -40 && rg -n onStart src/main/Timed.java" } }]),
      result("t3", "class TimedSpec {}"),
      line([{ type: "tool_use", id: "t4", name: "Bash", input: { command: "cat src/main/Denied.java" } }]),
      result("t4", "Permission denied: this command requires approval", true),
      line([{ type: "tool_use", id: "t5", name: "Read", input: { file_path: "src/main/Missing.java" } }]),
      result("t5", "<tool_use_error>File does not exist.</tool_use_error>"),
      line([{ type: "tool_use", id: "t6", name: "Glob", input: { pattern: "**/*Spec.groovy" } }]),
      "not json",
      JSON.stringify({ type: "result", result: "done" })
    ].join("\n");
    expect(filesReadFromTranscript("claude", stdout)).toEqual(["/repo/src/main/Timed.java", "src/test/TimedSpec.groovy", "src/main/Timed.java"]);
    expect(filesReadFromTranscript("codex", stdout)).toEqual([]);
  });

  it("parses the FILES READ list the agent ends with and strips it from the notes", () => {
    const notes = [
      "## 6. Review",
      "Verdict: comment.",
      "",
      "FILES READ:",
      "- src/main/Timed.java",
      "* `src/main/Cache.java` (the copy-on-write map)",
      "3. src/test/TimedSpec.groovy - lifecycle assertions",
      "README.md"
    ].join("\n");
    expect(parseFilesReadList(notes)).toEqual(["src/main/Timed.java", "src/main/Cache.java", "src/test/TimedSpec.groovy", "README.md"]);
    expect(stripFilesReadList(notes)).toBe("## 6. Review\nVerdict: comment.");
    expect(parseFilesReadList("no list here")).toEqual([]);
    expect(stripFilesReadList("no list here")).toBe("no list here");
    // Markdown heading or bold variants of the marker also count, and only the last marker is used.
    expect(parseFilesReadList("FILES READ:\nold.txt\n\n**FILES READ:**\nsrc/main/Timed.java")).toEqual(["src/main/Timed.java"]);
  });

  it("keeps only files that exist inside the checkout, as unique repository-relative paths", async () => {
    const dir = await checkout();
    const resolved = resolveReadPaths(
      [join(dir, "src/main/Timed.java"), "src/main/Timed.java", "./src/main/Cache.java", "src/main", "src/main/Missing.java", "/etc/hosts", "../outside.txt", ".git/config", "src/test/TimedSpec.groovy"],
      dir
    );
    expect(resolved).toEqual(["src/main/Timed.java", "src/main/Cache.java", "src/test/TimedSpec.groovy"]);
  });
});
