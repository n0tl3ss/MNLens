import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The team folder is resolved from MNLENS_TEAM_DIR at call time, so a temp
 * folder per test file is enough to exercise the shared read/write paths.
 */
let teamDir: string;
let previousTeamDir: string | undefined;

beforeAll(async () => {
  teamDir = await mkdtemp(join(tmpdir(), "mnlens-team-"));
  previousTeamDir = process.env.MNLENS_TEAM_DIR;
  process.env.MNLENS_TEAM_DIR = teamDir;
});

afterAll(() => {
  if (previousTeamDir === undefined) delete process.env.MNLENS_TEAM_DIR;
  else process.env.MNLENS_TEAM_DIR = previousTeamDir;
});

describe("team store", () => {
  it("honours MNLENS_MEMBER_ID and sanitizes it for use as a file name", async () => {
    const { computeMemberId } = await import("../src/server/teamStore.js");
    expect(computeMemberId("n0tl3ss / laptop")).toBe("n0tl3ss___laptop");
    expect(computeMemberId("   ")).toMatch(/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$/);
    expect(computeMemberId()).toContain("@");
  });

  it("reports the env-configured folder and this machine's member id", async () => {
    const { teamStatus, memberId } = await import("../src/server/teamStore.js");
    const status = await teamStatus();
    expect(status.source).toBe("env");
    expect(status.dir).toBe(teamDir);
    expect(status.exists).toBe(true);
    expect(status.writable).toBe(true);
    expect(status.memberId).toBe(memberId());
    expect(memberId()).toMatch(/^[a-zA-Z0-9_.@-]+$/);
  });

  it("writes json per repository and merges every member's memory file on read", async () => {
    const { writeTeamJson, readTeamJson, readTeamMemoryFiles, memberId } = await import("../src/server/teamStore.js");
    expect(await writeTeamJson("acme/app", "rules.json", [{ id: "r1" }])).toBe(true);
    expect(await readTeamJson<{ id: string }[]>("acme/app", "rules.json")).toEqual([{ id: "r1" }]);
    await writeTeamJson("acme/app", `memory/${memberId()}.json`, [{ id: "a", verdict: "kept" }]);
    await mkdir(join(teamDir, "acme__app", "memory"), { recursive: true });
    await writeFile(join(teamDir, "acme__app", "memory", "bob@laptop.json"), JSON.stringify([{ id: "b", prKey: "acme__app__3", repository: "acme/app", kind: "risk", title: "Thread safety", verdict: "dismissed", at: "2026-01-01T00:00:00.000Z" }]));
    await writeFile(join(teamDir, "acme__app", "memory", "broken.json"), "{not json");
    const files = await readTeamMemoryFiles<{ id: string }>("acme/app");
    expect(files?.map((file) => file.member).sort()).toEqual(["bob@laptop", memberId()].sort());
    expect(files?.flatMap((file) => file.entries.map((entry) => entry.id)).sort()).toEqual(["a", "b"]);
    const status = await (await import("../src/server/teamStore.js")).teamStatus();
    expect(status.repositories).toEqual(["acme/app"]);
  });

  it("merges team verdicts into the memory summary and counts members", async () => {
    const { reviewMemorySummary, recordFindingFeedback } = await import("../src/server/reviewMemory.js");
    await recordFindingFeedback({ owner: "acme", repo: "app", number: 7, kind: "draft-comment", title: "register() is empty", verdict: "kept", commentKind: "blocking" });
    await recordFindingFeedback({ owner: "acme", repo: "app", number: 7, kind: "draft-comment", title: "Rename c", verdict: "dismissed", commentKind: "nit" });
    const summary = await reviewMemorySummary("acme", "app", 7);
    expect(summary.shared).toBe(true);
    expect(summary.members).toBe(2);
    expect(summary.draftComments).toEqual({ kept: 1, dismissed: 1, byKind: { blocking: { kept: 1, dismissed: 0 }, nit: { kept: 0, dismissed: 1 } } });
    expect(summary.total).toBe(3); // bob's verdict counts too; the malformed "a" entry from the raw write above is ignored
    expect(summary.prVerdicts["draft-comment:register is empty"]).toBe("kept");
    const own = JSON.parse(await readFile(join(teamDir, "acme__app", "memory", `${(await import("../src/server/teamStore.js")).memberId()}.json`), "utf8")) as { title: string; member: string }[];
    expect(own.map((entry) => entry.title)).toEqual(["register() is empty", "Rename c"]);
    expect(own[0].member).toBeTruthy();
  });

  it("stores rules in the team folder and keeps repository-rule overrides", async () => {
    const { createRepoRule, listRepoRules, updateRepoRule, exportRepoRules } = await import("../src/server/repoRules.js");
    const rule = await createRepoRule("acme/app", { title: "No TODOs", body: "Do not add TODO markers." });
    expect(rule.origin).toBe("team");
    const stored = JSON.parse(await readFile(join(teamDir, "acme__app", "rules.json"), "utf8")) as { id: string }[];
    expect(stored.map((item) => item.id)).toContain(rule.id);
    const updated = await updateRepoRule("acme/app", rule.id, { enabled: false });
    expect(updated?.enabled).toBe(false);
    const listed = await listRepoRules("acme/app", { skipRepository: true });
    expect(listed.find((item) => item.id === rule.id)).toMatchObject({ enabled: false, origin: "team" });
    const exported = await exportRepoRules("acme/app");
    expect(exported.path).toBe(".mnlens/review-rules.json");
    expect(exported.rules).toBe(0); // disabled rules are not exported
    await updateRepoRule("acme/app", rule.id, { enabled: true });
    const exportedAgain = await exportRepoRules("acme/app");
    expect(JSON.parse(exportedAgain.content)).toMatchObject({ version: 1, repository: "acme/app", rules: [{ id: "no-todos", title: "No TODOs" }] });
  });
});
