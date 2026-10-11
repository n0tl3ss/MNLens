import { describe, expect, it } from "vitest";
import { clearPrCache, readFastAnalysis, writeFastAnalysis } from "../src/server/cache.js";

describe("fast analysis cache", () => {
  it("persists fast scores per PR and clears them with the PR cache", async () => {
    const key = "acme__app__424242";
    await writeFastAnalysis({ prKey: key, updatedAt: "2026-10-11T20:00:00.000Z", aiType: "bug", aiRiskCount: 2, aiTestsCount: 1, analysisStatus: "done", analysisMode: "fast", analysisUpdatedAt: "2026-10-11T20:00:00.000Z", changedFiles: 3, fastScore: 63, fastScoreLabel: "fast work left", fastScoreTone: "queue", fastScoreConfidence: "medium" });
    const record = await readFastAnalysis(key);
    expect(record).toMatchObject({ fastScore: 63, analysisMode: "fast", aiType: "bug" });
    await clearPrCache(key);
    expect(await readFastAnalysis(key)).toBeUndefined();
  });
});
