import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AnalysisResult } from "../src/shared/types.js";

/**
 * The cache dir is resolved from MNLENS_CACHE_DIR when paths.ts loads, so the
 * modules under test are imported after a temp dir is in place.
 */
let cacheRoot: string;
let previousCacheDir: string | undefined;
let previousTeamDir: string | undefined;
let cache: typeof import("../src/server/cache.js");
let delta: typeof import("../src/server/analysisDelta.js");
let memory: typeof import("../src/server/reviewMemory.js");

beforeAll(async () => {
  cacheRoot = await mkdtemp(join(tmpdir(), "mnlens-analysis-history-"));
  previousCacheDir = process.env.MNLENS_CACHE_DIR;
  previousTeamDir = process.env.MNLENS_TEAM_DIR;
  process.env.MNLENS_CACHE_DIR = cacheRoot;
  delete process.env.MNLENS_TEAM_DIR;
  cache = await import("../src/server/cache.js");
  delta = await import("../src/server/analysisDelta.js");
  memory = await import("../src/server/reviewMemory.js");
});

afterAll(async () => {
  if (previousCacheDir === undefined) delete process.env.MNLENS_CACHE_DIR;
  else process.env.MNLENS_CACHE_DIR = previousCacheDir;
  if (previousTeamDir !== undefined) process.env.MNLENS_TEAM_DIR = previousTeamDir;
  await rm(cacheRoot, { recursive: true, force: true });
});

const base = (prKey: string, diffHash: string, generatedAt: string, riskTitles: string[]): AnalysisResult => ({
  prKey,
  diffHash,
  type: "bug",
  confidence: 0.9,
  summary: "",
  evidence: [],
  reviewerFocus: [],
  risks: riskTitles,
  riskDetails: riskTitles.map((title) => ({ title, observation: `${title} observed`, perspective: "", recommendation: "", severity: "medium" as const })),
  testsToCheck: [],
  caveats: [],
  draftComment: "",
  generatedAt
});

describe("analysis history", () => {
  it("archives the previous analysis only when the diff changed, keeps the newest five and clears with the PR cache", async () => {
    const key = "acme__app__11";
    await cache.writeAnalysis(base(key, "d1", "2026-10-01T00:00:00.000Z", ["one"]));
    expect(await cache.readAnalysisHistory(key)).toEqual([]);

    // Same diff (forced re-run, second opinion attached, ...) is not history.
    await cache.writeAnalysis(base(key, "d1", "2026-10-01T01:00:00.000Z", ["one", "one-b"]));
    expect(await cache.readAnalysisHistory(key)).toEqual([]);

    for (let i = 2; i <= 8; i += 1) {
      await cache.writeAnalysis(base(key, `d${i}`, `2026-10-0${Math.min(i, 9)}T00:00:00.000Z`, [`r${i}`]));
    }
    const history = await cache.readAnalysisHistory(key);
    expect(history.map((entry) => entry.diffHash)).toEqual(["d7", "d6", "d5", "d4", "d3"]);
    expect(history[0].generatedAt > history[1].generatedAt).toBe(true);
    expect((await readdir(join(cacheRoot, "analysis-history", key))).length).toBe(cache.analysisHistoryLimit);
    expect((await cache.readAnalysis(key))?.diffHash).toBe("d8");

    await cache.clearPrCache(key);
    expect(await cache.readAnalysisHistory(key)).toEqual([]);
    expect(await cache.readAnalysis(key)).toBeUndefined();
  });

  it("builds the delta against the cached analysis when the diff changed, and against history on a same-diff re-run", async () => {
    const detail = { owner: "acme", repo: "app", number: 12, key: "acme__app__12" };
    const first = base(detail.key, "d1", "2026-10-01T00:00:00.000Z", ["Missing null check", "Unbounded cache growth"]);
    expect(await delta.deltaAgainstPrevious(detail, undefined, first)).toBeUndefined();
    await cache.writeAnalysis(first);

    const second = base(detail.key, "d2", "2026-10-02T00:00:00.000Z", ["Missing null check", "Secrets in logs"]);
    const secondDelta = await delta.deltaAgainstPrevious(detail, first, second);
    expect(secondDelta).toMatchObject({ previousDiffHash: "d1", previousGeneratedAt: first.generatedAt });
    expect(secondDelta?.resolved.map((item) => item.title)).toEqual(["Unbounded cache growth"]);
    expect(secondDelta?.added.map((item) => item.title)).toEqual(["Secrets in logs"]);
    expect(secondDelta?.persisting.map((item) => item.title)).toEqual(["Missing null check"]);
    await cache.writeAnalysis({ ...second, delta: secondDelta });

    // Forced re-run on the same diff: compare with the last analysis of a different diff, not with itself.
    const rerun = base(detail.key, "d2", "2026-10-02T01:00:00.000Z", ["Missing null check", "Secrets in logs", "Retry storm"]);
    const rerunDelta = await delta.deltaAgainstPrevious(detail, { ...second, delta: secondDelta }, rerun);
    expect(rerunDelta?.previousDiffHash).toBe("d1");
    expect(rerunDelta?.added.map((item) => item.title)).toEqual(["Secrets in logs", "Retry storm"]);
    await cache.clearPrCache(detail.key);
  });

  it("carries the reviewer's verdict onto a reworded persisting finding without counting it twice", async () => {
    const detail = { owner: "acme", repo: "memory-app", number: 3, key: "acme__memory-app__3" };
    await memory.recordFindingFeedback({ owner: detail.owner, repo: detail.repo, number: detail.number, kind: "risk", title: "Retry loop never backs off", verdict: "dismissed", reason: "Broker throttles us anyway." });
    await memory.recordFindingFeedback({ owner: detail.owner, repo: detail.repo, number: detail.number, kind: "risk", title: "Secrets logged at debug level", verdict: "kept" });

    const previous = base(detail.key, "d1", "2026-10-01T00:00:00.000Z", []);
    previous.riskDetails = [
      { title: "Retry loop never backs off", observation: "The reconnect loop retries immediately in a tight loop when the socket closes.", perspective: "", recommendation: "", severity: "medium" },
      { title: "Secrets logged at debug level", observation: "The connection string is written to the debug log.", perspective: "", recommendation: "", severity: "high" }
    ];
    const next = base(detail.key, "d2", "2026-10-02T00:00:00.000Z", []);
    next.riskDetails = [
      { title: "Reconnect loop retries without a delay", observation: "The reconnect loop retries immediately in a tight loop when the socket closes, saturating the broker.", perspective: "", recommendation: "", severity: "medium" },
      { title: "Secrets logged at debug level", observation: "The connection string is written to the debug log.", perspective: "", recommendation: "", severity: "high" }
    ];

    const result = await delta.deltaAgainstPrevious(detail, previous, next);
    expect(result?.persisting.map((item) => item.previousTitle)).toEqual(["Retry loop never backs off", undefined]);
    expect(result?.carriedVerdicts).toBe(1);

    const summary = await memory.reviewMemorySummary(detail.owner, detail.repo, detail.number);
    expect(summary.prVerdicts[memory.verdictKey("risk", "Reconnect loop retries without a delay")]).toBe("dismissed");
    expect(summary.prVerdicts[memory.verdictKey("risk", "Retry loop never backs off")]).toBe("dismissed");
    expect(summary.prVerdicts[memory.verdictKey("risk", "Secrets logged at debug level")]).toBe("kept");
    // The copy is the same human decision: calibration still sees two verdicts, not three.
    expect(summary.total).toBe(2);
    expect(summary.dismissed).toBe(1);

    // Running the same comparison again (or a re-run on the same diff) copies nothing new.
    expect(await memory.carryOverFindingVerdicts(detail.owner, detail.repo, detail.number, [{ kind: "risk", previousTitle: "Retry loop never backs off", title: "Reconnect loop retries without a delay" }])).toBe(0);

    // A verdict the reviewer already gave on the new title wins over the carried one.
    await memory.recordFindingFeedback({ owner: detail.owner, repo: detail.repo, number: detail.number, kind: "risk", title: "Fresh title", verdict: "kept" });
    expect(await memory.carryOverFindingVerdicts(detail.owner, detail.repo, detail.number, [{ kind: "risk", previousTitle: "Retry loop never backs off", title: "Fresh title" }])).toBe(0);
    expect((await memory.reviewMemorySummary(detail.owner, detail.repo, detail.number)).prVerdicts[memory.verdictKey("risk", "Fresh title")]).toBe("kept");
  });
});
