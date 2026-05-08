import express from "express";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AnalyzeRequest,
  AttachGithubProjectRequest,
  AskCiRequest,
  AskResearchRequest,
  AskRiskRequest,
  CreateRepoReviewRuleRequest,
  FixRequest,
  OpenEditorRequest,
  ManualVerificationRequest,
  PushFixRequest,
  RetryFixRequest,
  StoreGithubTokenRequest,
  CiLogRequest,
  QueueName,
  RebasePrConfirmRequest,
  RebasePrRequest,
  ReplyConversationRequest,
  SubmitReviewRequest,
  UpdateRepoReviewRuleRequest,
  UpdateReviewProgressRequest,
  VerificationRequest
} from "../shared/types.js";
import { clearAllCache, clearPrCache, ensureCache, exportCacheBundle, readAnalysis, readPrDetail, readProgress, readRepoRules, stats, writeAnalysis, writeProgress, writeRepoRules } from "./cache.js";
import { attachPrToGithubProject, authStatus, confirmRebasePrOntoDefault, getCiChecks, getCiLog, getPrDetail, listGithubProjects, listPrs, listRepositoryBranches, rebasePrOntoDefault, replyToConversation, submitReview, updatePrTargetBranch } from "./gh.js";
import { cancelAnalysisJob, enqueueAnalysis, getJob, jobStatusForPr, recoverAnalysisJobs } from "./jobs.js";
import { cancelVerificationJob, enqueueManualVerification, enqueueVerification, getVerificationJob, listVerificationJobs } from "./verification.js";
import { recoverVerificationJobs } from "./verification.js";
import { askFixQuestion, cancelFix, enqueueFix, getFixJob, getFixLiveDiff, listActiveFixJobs, listFixJobs, pushFix, recoverFixJobs, retryFix } from "./fix.js";
import { askCiFailure, askResearch, askRisk, normalizeAnalysisForDetail, normalizeAnalysisWithLocalGradleChecks } from "./codex.js";
import { openPrInEditor } from "./editor.js";
import { storeGithubToken } from "./keychain.js";
import { getSetupStatus } from "./setup.js";
import { cacheDir } from "./paths.js";
import { enhanceCliPath } from "./envPath.js";
import { GithubRateLimitError, githubRateLimitStatus } from "./githubRateLimit.js";

const port = Number(process.env.PORT ?? 4321);
const requestedHost = process.env.HOST ?? process.env.MNLENS_HOST ?? "127.0.0.1";
const host = process.env.MNLENS_ALLOW_REMOTE === "true" || isLocalHostName(requestedHost) ? requestedHost : "127.0.0.1";
const isProduction = process.env.NODE_ENV === "production";
const localSessionToken = process.env.MNLENS_SESSION_TOKEN ?? randomUUID();

export async function createApp(options: { serveClient?: boolean; recoverJobs?: boolean } = {}) {
  enhanceCliPath();
  await ensureCache();
  if (options.recoverJobs ?? (options.serveClient ?? true)) {
    await Promise.all([recoverAnalysisJobs(), recoverVerificationJobs(), recoverFixJobs()]);
  }
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/session", (_req, res) => {
    res.json({
      token: localSessionToken,
      mode: "local",
      betaLimitations: betaLimitations()
    });
  });

  app.use("/api", localSessionGuard);

  app.get("/api/artifacts/:jobId/:fileName", (req, res) => {
    const jobId = req.params.jobId;
    const fileName = req.params.fileName;
    if (!/^[a-z0-9-]+$/i.test(jobId) || fileName.includes("/") || fileName.includes("\\")) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }
    const root = resolve(cacheDir, "artifacts", jobId);
    const resolved = resolve(root, fileName);
    if (!resolved.startsWith(`${root}/`) || !existsSync(resolved)) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }
    res.sendFile(resolved, { dotfiles: "allow" });
  });

  app.get("/api/artifacts", (req, res) => {
    const file = String(req.query.path ?? "");
    const resolved = resolve(file);
    const allowedRoot = resolve(cacheDir);
    if (!file || !resolved.startsWith(`${allowedRoot}/`) || !existsSync(resolved)) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }
    res.sendFile(resolved, { dotfiles: "allow" });
  });

  app.get("/api/auth/status", async (_req, res) => {
    res.json(await authStatus());
  });

  app.get("/api/github-projects/:owner", async (req, res, next) => {
    try {
      res.json(await listGithubProjects(req.params.owner));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/github-projects/attach", async (req, res, next) => {
    try {
      const body = req.body as AttachGithubProjectRequest;
      if (!body.owner || !body.repo || !body.number || !body.projectId) {
        res.status(400).json({ error: "owner, repo, number, and projectId are required." });
        return;
      }
      res.json(await attachPrToGithubProject(body.owner, body.repo, body.number, body.projectId, body.includeLinkedIssues ?? true));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/setup/status", async (_req, res, next) => {
    try {
      res.json(await getSetupStatus());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/github/rate-limit", (_req, res) => {
    res.json(githubRateLimitStatus());
  });

  app.post("/api/auth/token", async (req, res, next) => {
    try {
      const body = req.body as StoreGithubTokenRequest;
      if (!body.token?.trim()) {
        res.status(400).json({ error: "GitHub token is required." });
        return;
      }
      await storeGithubToken(body.token);
      res.json(await authStatus());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/prs", async (req, res, next) => {
    try {
      const queue = normalizeQueue(req.query.queue);
      const includeMine = req.query.includeMine === "true";
      const prs = await listPrs(queue, includeMine);
      res.json(
        prs.map((pr) => {
          const activeJob = jobStatusForPr(pr.key);
          return activeJob && activeJob.status !== "done"
            ? { ...pr, analysisStatus: activeJob.status, analysisUpdatedAt: activeJob.updatedAt }
            : pr;
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/prs/:owner/:repo/:number", async (req, res, next) => {
    try {
      const detail = await getPrDetail(req.params.owner, req.params.repo, Number(req.params.number));
      res.json(detail);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/repos/:owner/:repo/branches", async (req, res, next) => {
    try {
      res.json(await listRepositoryBranches(req.params.owner, req.params.repo));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/prs/:owner/:repo/:number/target-branch", async (req, res, next) => {
    try {
      const baseRefName = String(req.body?.baseRefName ?? "").trim();
      if (!baseRefName) {
        res.status(400).json({ error: "Target branch is required." });
        return;
      }
      res.json(await updatePrTargetBranch(req.params.owner, req.params.repo, Number(req.params.number), baseRefName));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/analyze", async (req, res, next) => {
    try {
      const body = req.body as AnalyzeRequest;
      if (!Array.isArray(body.prs) || body.prs.length === 0) {
        res.status(400).json({ error: "Request must include at least one PR." });
        return;
      }
      res.json({ jobs: await enqueueAnalysis(body) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/analysis/:key", async (req, res) => {
    const [analysis, detail] = await Promise.all([readAnalysis(req.params.key), readPrDetail(req.params.key)]);
    if (!analysis || !detail) {
      res.json(analysis ?? null);
      return;
    }
    const normalized = await normalizeAnalysisWithLocalGradleChecks(detail, normalizeAnalysisForDetail(detail, analysis)).catch(() =>
      normalizeAnalysisForDetail(detail, analysis)
    );
    if (JSON.stringify(normalized.testsToCheck) !== JSON.stringify(analysis.testsToCheck)) {
      await writeAnalysis(normalized);
    }
    res.json(normalized);
  });

  app.post("/api/ask-risk", async (req, res, next) => {
    try {
      const body = req.body as AskRiskRequest;
      if (!body.owner || !body.repo || !body.number || !body.question?.trim() || !body.risk?.observation?.trim()) {
        res.status(400).json({ error: "Risk question must include owner, repo, number, risk, and question." });
        return;
      }
      const detail = await getPrDetail(body.owner, body.repo, Number(body.number));
      res.json({ answer: await askRisk(detail, body.risk, body.question) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/ask-ci", async (req, res, next) => {
    try {
      const body = req.body as AskCiRequest;
      if (!body.owner || !body.repo || !body.number || !body.check?.name) {
        res.status(400).json({ error: "CI question must include owner, repo, number, and check." });
        return;
      }
      const detail = await getPrDetail(body.owner, body.repo, Number(body.number));
      res.json({ answer: await askCiFailure(detail, body.check, body.log ?? "") });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/ask-research", async (req, res, next) => {
    try {
      const body = req.body as AskResearchRequest;
      if (!body.owner || !body.repo || !body.number || !body.source || !body.question?.trim()) {
        res.status(400).json({ error: "Research question must include owner, repo, number, source, and question." });
        return;
      }
      const detail = await getPrDetail(body.owner, body.repo, Number(body.number));
      res.json({ answer: await askResearch(detail, body.source, body.question) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/reviews", async (req, res, next) => {
    try {
      const body = req.body as SubmitReviewRequest;
      if (body.event !== "APPROVE" && body.event !== "REQUEST_CHANGES") {
        res.status(400).json({ error: "Review event must be APPROVE or REQUEST_CHANGES." });
        return;
      }
      if (body.comments !== undefined && !Array.isArray(body.comments)) {
        res.status(400).json({ error: "Review comments must be an array." });
        return;
      }
      res.json(await submitReview(body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/conversation-replies", async (req, res, next) => {
    try {
      const body = req.body as ReplyConversationRequest;
      if (!body.owner || !body.repo || !body.number || !body.body?.trim()) {
        res.status(400).json({ error: "Conversation reply must include owner, repo, number, and body." });
        return;
      }
      res.json(await replyToConversation(body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/jobs/:id", async (req, res) => {
    const job = await getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(job);
  });

  app.post("/api/jobs/:id/cancel", async (req, res, next) => {
    try {
      res.json(await cancelAnalysisJob(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/ci/:owner/:repo/:number", async (req, res, next) => {
    try {
      res.json(await getCiChecks(req.params.owner, req.params.repo, Number(req.params.number)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/ci/logs", async (req, res, next) => {
    try {
      const body = req.body as CiLogRequest;
      if (!body.owner || !body.repo || !body.link) {
        res.status(400).json({ error: "CI log request must include owner, repo, and link." });
        return;
      }
      res.json({ log: await getCiLog(body.owner, body.repo, body.link) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rebase-default", async (req, res, next) => {
    try {
      const body = req.body as RebasePrRequest;
      if (!body.owner || !body.repo || !body.number) {
        res.status(400).json({ error: "Rebase request must include owner, repo, and number." });
        return;
      }
      const result = await rebasePrOntoDefault(body.owner, body.repo, Number(body.number));
      if (!result.success) {
        res.status(409).json({ error: result.message, ...result });
        return;
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rebase-default/confirm", async (req, res, next) => {
    try {
      const body = req.body as RebasePrConfirmRequest;
      if (!body.previewId) {
        res.status(400).json({ error: "Rebase confirmation must include previewId." });
        return;
      }
      res.json(await confirmRebasePrOntoDefault(body.previewId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/verification", async (req, res, next) => {
    try {
      const body = req.body as VerificationRequest;
      if (!body.owner || !body.repo || !body.number || !body.command?.trim()) {
        res.status(400).json({ error: "Verification request must include owner, repo, number, and command." });
        return;
      }
      res.json(await enqueueVerification(body, body.command));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/verification/manual", async (req, res, next) => {
    try {
      const body = req.body as ManualVerificationRequest;
      if (!body.owner || !body.repo || !body.number || !body.item || !body.id) {
        res.status(400).json({ error: "Manual verification request must include owner, repo, number, id, and item." });
        return;
      }
      res.json(await enqueueManualVerification(body, body.item, body.id));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/verification", async (req, res, next) => {
    try {
      const key = typeof req.query.prKey === "string" ? req.query.prKey : "";
      if (!key) {
        res.status(400).json({ error: "Verification history request must include prKey." });
        return;
      }
      res.json(await listVerificationJobs(key));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/verification/:id", async (req, res) => {
    const job = await getVerificationJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Verification job not found" });
      return;
    }
    res.json(job);
  });

  app.post("/api/verification/:id/cancel", async (req, res, next) => {
    try {
      res.json(await cancelVerificationJob(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/fixes", async (req, res, next) => {
    try {
      const body = req.body as FixRequest;
      if (!body.owner || !body.repo || !body.number) {
        res.status(400).json({ error: "Fix request must include owner, repo, and number." });
        return;
      }
      res.json(await enqueueFix(body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/fixes/:id", async (req, res) => {
    const job = await getFixJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Fix job not found" });
      return;
    }
    res.json(job);
  });

  app.get("/api/fixes/:id/diff", async (req, res, next) => {
    try {
      res.json(await getFixLiveDiff(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/fixes/:id/push", async (req, res, next) => {
    try {
      const body = req.body as Partial<PushFixRequest>;
      if (body.id && body.id !== req.params.id) {
        res.status(400).json({ error: "Fix id mismatch." });
        return;
      }
      res.json(await pushFix(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/fixes/:id/retry", async (req, res, next) => {
    try {
      const body = req.body as Partial<RetryFixRequest>;
      if (body.id && body.id !== req.params.id) {
        res.status(400).json({ error: "Fix id mismatch." });
        return;
      }
      res.json(await retryFix(req.params.id, body.instructions ?? ""));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/fixes/:id/ask", async (req, res, next) => {
    try {
      const body = req.body as { id?: string; question?: string };
      if (body.id && body.id !== req.params.id) {
        res.status(400).json({ error: "Fix id mismatch." });
        return;
      }
      res.json(await askFixQuestion(req.params.id, body.question ?? ""));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/fixes/:id/cancel", async (req, res, next) => {
    try {
      res.json(await cancelFix(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/fixes", async (req, res) => {
    const key = String(req.query.prKey ?? "");
    if (req.query.active === "true") {
      res.json(await listActiveFixJobs());
      return;
    }
    if (!key) {
      res.status(400).json({ error: "prKey is required" });
      return;
    }
    res.json(await listFixJobs(key));
  });

  app.post("/api/open-editor", async (req, res, next) => {
    try {
      const body = req.body as OpenEditorRequest;
      if (!body.owner || !body.repo || !body.number || (body.editor !== "vscode" && body.editor !== "intellij")) {
        res.status(400).json({ error: "Open editor request must include owner, repo, number, and editor." });
        return;
      }
      res.json(await openPrInEditor(body, body.editor));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/progress/:key", async (req, res) => {
    res.json(
      (await readProgress(req.params.key)) ?? {
        prKey: req.params.key,
        checkedItems: [],
        reviewedFiles: [],
        ignoredRuleIds: [],
        manualChecks: {},
        project: "",
        issueProjects: {},
        notes: "",
        lastReviewedAt: undefined,
        updatedAt: new Date().toISOString()
      }
    );
  });

  app.put("/api/progress/:key", async (req, res, next) => {
    try {
      const body = req.body as UpdateReviewProgressRequest;
      const existing = await readProgress(req.params.key);
      const progress = {
        prKey: req.params.key,
        checkedItems: body.checkedItems ?? existing?.checkedItems ?? [],
        reviewedFiles: body.reviewedFiles ?? existing?.reviewedFiles ?? [],
        ignoredRuleIds: body.ignoredRuleIds ?? existing?.ignoredRuleIds ?? [],
        manualChecks: body.manualChecks ?? existing?.manualChecks ?? {},
        project: body.project ?? existing?.project ?? "",
        issueProjects: body.issueProjects ?? existing?.issueProjects ?? {},
        notes: body.notes ?? existing?.notes ?? "",
        lastReviewedAt: body.lastReviewedAt ?? existing?.lastReviewedAt,
        updatedAt: new Date().toISOString()
      };
      await writeProgress(progress);
      res.json(progress);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/repo-rules/:owner/:repo", async (req, res, next) => {
    try {
      res.json(await readRepoRules(`${req.params.owner}/${req.params.repo}`));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/repo-rules/:owner/:repo", async (req, res, next) => {
    try {
      const repository = `${req.params.owner}/${req.params.repo}`;
      const body = req.body as CreateRepoReviewRuleRequest;
      if (!body.title?.trim() || !body.body?.trim()) {
        res.status(400).json({ error: "Rule title and body are required." });
        return;
      }
      const rules = await readRepoRules(repository);
      const now = new Date().toISOString();
      const rule = {
        id: `rule:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
        repository,
        title: body.title.trim(),
        body: body.body.trim(),
        tone: body.tone?.trim() || "neutral",
        enabled: true,
        source: body.source?.trim() || "manual",
        createdAt: now,
        updatedAt: now
      };
      await writeRepoRules(repository, [rule, ...rules]);
      res.json(rule);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/repo-rules/:owner/:repo/:id", async (req, res, next) => {
    try {
      const repository = `${req.params.owner}/${req.params.repo}`;
      const body = req.body as UpdateRepoReviewRuleRequest;
      const rules = await readRepoRules(repository);
      const index = rules.findIndex((rule) => rule.id === req.params.id);
      if (index < 0) {
        res.status(404).json({ error: "Rule not found." });
        return;
      }
      const current = rules[index];
      const nextRule = {
        ...current,
        title: body.title?.trim() || current.title,
        body: body.body?.trim() || current.body,
        tone: body.tone?.trim() || current.tone,
        enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
        updatedAt: new Date().toISOString()
      };
      rules[index] = nextRule;
      await writeRepoRules(repository, rules);
      res.json(nextRule);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/cache", async (_req, res) => {
    res.json(await stats());
  });

  app.post("/api/cache/export", async (_req, res, next) => {
    try {
      const bundle = await exportCacheBundle();
      res.json({
        ...bundle,
        url: `/api/artifacts?path=${encodeURIComponent(bundle.path)}`
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/cache", async (_req, res, next) => {
    try {
      await clearAllCache();
      res.json({ clearedAt: new Date().toISOString(), cacheDir });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/cache/:key", async (req, res, next) => {
    try {
      await clearPrCache(req.params.key);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof GithubRateLimitError) {
      res.status(error.status).json({ error: message, rateLimit: githubRateLimitStatus() });
      return;
    }
    res.status(500).json({ error: message });
  });

  if (options.serveClient ?? true) {
    if (isProduction) {
      const clientDir = join(projectRoot(), "dist", "client");
      app.use(express.static(clientDir));
      app.get(/.*/, (_req, res) => {
        res.sendFile(join(clientDir, "index.html"));
      });
    } else {
      await clearViteDevCache();
      app.use((req, res, next) => {
        if (!req.path.startsWith("/api")) {
          res.setHeader("Cache-Control", "no-store");
        }
        next();
      });
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        cacheDir: join(projectRoot(), "node_modules", ".vite"),
        optimizeDeps: { force: true },
        server: { middlewareMode: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
    }
  }

  return app;
}

export async function startServer() {
  const app = await createApp();
  app.listen(port, host, () => {
    const label = host === "127.0.0.1" ? "localhost" : host;
    console.log(`MNLens listening on http://${label}:${port}`);
  });
}

function localSessionGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
  const origin = req.get("origin");
  if (origin && !isAllowedLocalOrigin(origin)) {
    res.status(403).json({ error: "MNLens only accepts API requests from the local app origin." });
    return;
  }
  const token = req.get("x-mnlens-session") ?? "";
  if (token !== localSessionToken) {
    res.status(403).json({ error: "Missing or invalid MNLens local session token. Reload the app and try again." });
    return;
  }
  next();
}

function isAllowedLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return isLocalHostName(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHostName(value: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(value);
}

function betaLimitations(): string[] {
  return [
    "MNLens is a local review assistant. It should be opened from this machine, not exposed on a network.",
    "GitHub, Git, Codex, Java, Gradle, Maven, and browser tooling are discovered from local command-line tools.",
    "Queued jobs are recovered after restart. Jobs that were running are shown as interrupted/resumable with logs and workspace context preserved.",
    "Codex prepares reviewable code changes. It does not commit or push until a human explicitly approves.",
    "Repository checkouts, Codex state, and artifacts are stored under the local MNLens cache directory."
  ];
}

function normalizeQueue(value: unknown): QueueName {
  if (value === "assigned" || value === "review-requested" || value === "all") return value;
  return "all";
}

function projectRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [process.cwd(), dirname(dirname(here)), dirname(dirname(dirname(here)))];
  return candidates.find((candidate) => existsSync(join(candidate, "package.json"))) ?? process.cwd();
}

async function clearViteDevCache(): Promise<void> {
  await rm(join(projectRoot(), "node_modules", ".vite"), { recursive: true, force: true });
}
