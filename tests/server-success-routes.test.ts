import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  cancelAnalysisJob: vi.fn(),
  cancelVerificationJob: vi.fn(),
  rebasePrOntoDefault: vi.fn(),
  updatePrBranch: vi.fn(),
  confirmRebasePrOntoDefault: vi.fn(),
  enqueueVerification: vi.fn(),
  enqueueFix: vi.fn(),
  pushFix: vi.fn()
}));

vi.mock("../src/server/gh.js", () => ({
  authStatus: vi.fn(async () => ({
    hasKeychainToken: true,
    ghAvailable: true,
    ghAuthenticated: true,
    tokenStore: "macos-keychain",
    setupSupported: true,
    setupHint: "",
    scopeCheck: "ok",
    username: "tester"
  })),
  confirmRebasePrOntoDefault: mocks.confirmRebasePrOntoDefault,
  getCiChecks: vi.fn(async () => []),
  getCiLog: vi.fn(async () => ""),
  getPrDetail: vi.fn(),
  listPrs: vi.fn(async () => []),
  listGithubProjects: vi.fn(async () => []),
  listRepositoryBranches: vi.fn(async () => []),
  mergePrTargetIntoHead: vi.fn(),
  rebasePrOntoDefault: mocks.rebasePrOntoDefault,
  replyToConversation: vi.fn(),
  submitReview: vi.fn(),
  updatePrBranch: mocks.updatePrBranch,
  updatePrTargetBranch: vi.fn()
}));

vi.mock("../src/server/verification.js", () => ({
  cancelVerificationJob: mocks.cancelVerificationJob,
  enqueueManualVerification: vi.fn(),
  enqueueVerification: mocks.enqueueVerification,
  getVerificationJob: vi.fn(),
  listVerificationJobs: vi.fn(async () => [])
}));

vi.mock("../src/server/fix.js", () => ({
  askFixQuestion: vi.fn(),
  cancelFix: vi.fn(),
  enqueueFix: mocks.enqueueFix,
  getFixJob: vi.fn(),
  getFixLiveDiff: vi.fn(),
  listActiveFixJobs: vi.fn(async () => []),
  listFixJobs: vi.fn(async () => []),
  pushFix: mocks.pushFix,
  retryFix: vi.fn()
}));

vi.mock("../src/server/jobs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/jobs.js")>();
  return {
    ...actual,
    cancelAnalysisJob: mocks.cancelAnalysisJob
  };
});

describe("server API success routes", () => {
  let server: Server;
  let baseUrl: string;
  let sessionToken: string;

  beforeAll(async () => {
    const { createApp } = await import("../src/server/app.js");
    const app = await createApp({ serveClient: false });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not bind test server.");
    baseUrl = `http://127.0.0.1:${address.port}`;
    const session = (await (await fetch(`${baseUrl}/api/session`)).json()) as { token: string };
    sessionToken = session.token;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("prepares and confirms a branch update preview", async () => {
    mocks.updatePrBranch.mockResolvedValueOnce({
      success: true,
      strategy: "rebase",
      defaultBranch: "main",
      stdout: "preview ok",
      stderr: "",
      message: "Rebase preview ready.",
      previewId: "preview-1",
      diff: "diff --git a/file b/file"
    });
    mocks.confirmRebasePrOntoDefault.mockResolvedValueOnce({
      success: true,
      defaultBranch: "main",
      stdout: "push ok",
      stderr: "",
      message: "Approved rebase pushed.",
      pushed: true
    });

    const preview = await post("/api/rebase-default", { owner: "o", repo: "r", number: 1 });
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({ previewId: "preview-1", message: "Rebase preview ready." });
    expect(mocks.updatePrBranch).toHaveBeenCalledWith("o", "r", 1);

    const confirm = await post("/api/rebase-default/confirm", { previewId: "preview-1" });
    expect(confirm.status).toBe(200);
    await expect(confirm.json()).resolves.toMatchObject({ pushed: true, message: "Approved rebase pushed." });
    expect(mocks.confirmRebasePrOntoDefault).toHaveBeenCalledWith("preview-1");
  });

  it("enqueues a verification job", async () => {
    mocks.enqueueVerification.mockResolvedValueOnce({
      id: "verification-1",
      status: "queued",
      prKey: "o__r__1",
      command: "./gradlew test",
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:00:00.000Z",
      stdout: "",
      stderr: ""
    });

    const response = await post("/api/verification", { owner: "o", repo: "r", number: 1, command: "./gradlew test" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "verification-1", status: "queued", command: "./gradlew test" });
    expect(mocks.enqueueVerification).toHaveBeenCalledWith({ owner: "o", repo: "r", number: 1, command: "./gradlew test" }, "./gradlew test");
  });

  it("cancels analysis and verification jobs", async () => {
    mocks.cancelAnalysisJob.mockResolvedValueOnce({
      id: "analysis-1",
      status: "failed",
      prKey: "o__r__1",
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:01:00.000Z",
      error: "Analysis job cancelled by reviewer."
    });
    mocks.cancelVerificationJob.mockResolvedValueOnce({
      id: "verification-1",
      status: "failed",
      prKey: "o__r__1",
      command: "./gradlew test",
      phase: "completed",
      statusMessage: "Verification cancelled.",
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:01:00.000Z",
      stdout: "",
      stderr: "",
      error: "Cancelled by reviewer."
    });

    const analysis = await post("/api/jobs/analysis-1/cancel", { id: "analysis-1" });
    expect(analysis.status).toBe(200);
    await expect(analysis.json()).resolves.toMatchObject({ id: "analysis-1", status: "failed" });
    expect(mocks.cancelAnalysisJob).toHaveBeenCalledWith("analysis-1");

    const verification = await post("/api/verification/verification-1/cancel", { id: "verification-1" });
    expect(verification.status).toBe(200);
    await expect(verification.json()).resolves.toMatchObject({ id: "verification-1", status: "failed", statusMessage: "Verification cancelled." });
    expect(mocks.cancelVerificationJob).toHaveBeenCalledWith("verification-1");
  });

  it("starts a fix preview and pushes the approved result", async () => {
    mocks.enqueueFix.mockResolvedValueOnce({
      id: "fix-1",
      status: "queued",
      prKey: "o__r__1",
      source: "Overview/Risk #2",
      instructions: "Address lifecycle risk.",
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:00:00.000Z",
      stdout: "",
      stderr: ""
    });
    mocks.pushFix.mockResolvedValueOnce({
      id: "fix-1",
      status: "done",
      prKey: "o__r__1",
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:00:00.000Z",
      stdout: "",
      stderr: "",
      committed: true,
      pushed: true,
      commitSha: "abc123"
    });

    const fix = await post("/api/fixes", { owner: "o", repo: "r", number: 1, source: "Overview/Risk #2", instructions: "Address lifecycle risk." });
    expect(fix.status).toBe(200);
    await expect(fix.json()).resolves.toMatchObject({ id: "fix-1", source: "Overview/Risk #2" });
    expect(mocks.enqueueFix).toHaveBeenCalledWith({ owner: "o", repo: "r", number: 1, source: "Overview/Risk #2", instructions: "Address lifecycle risk." });

    const push = await post("/api/fixes/fix-1/push", { id: "fix-1" });
    expect(push.status).toBe(200);
    await expect(push.json()).resolves.toMatchObject({ id: "fix-1", pushed: true, commitSha: "abc123" });
    expect(mocks.pushFix).toHaveBeenCalledWith("fix-1");
  });

  function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mnlens-session": sessionToken
      },
      body: JSON.stringify(body)
    });
  }
});
