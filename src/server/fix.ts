import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FixJob, FixPipelineNode, FixRequest, JobStatus, PrDetail } from "../shared/types.js";
import { codexHome, ensureCodexHome } from "./codex.js";
import { CommandError } from "./command.js";
import { runCommand } from "./command.js";
import { prKey, readAnalysis, readFixJob, readFixJobs, readFixJobsForPr, readPrDetail, writeFixJob } from "./cache.js";
import { getPrDetail } from "./gh.js";
import { assertGithubRateLimitAvailable, noteGithubRateLimit } from "./githubRateLimit.js";
import { missingGithubTokenMessage, readGithubToken } from "./keychain.js";
import { cacheDir } from "./paths.js";
import { clearRecoveryPatch, interruptedJobPatch, parsePrKey } from "./recovery.js";

const fixJobs = new Map<string, FixJob>();
const queue: Array<{ job: FixJob; request: FixRequest }> = [];
const activeProcesses = new Map<string, ChildProcess>();
const cancelledJobs = new Set<string>();
const root = join(cacheDir, "fix-worktrees");
let activeFixWorkers = 0;
let recovered = false;
const maxConcurrentFixSessions = Number(process.env.MNLENS_FIX_CONCURRENCY ?? "2");
const fixVerificationTimeoutMs = 40 * 60_000;

type FixPipelinePhase = NonNullable<FixJob["phase"]>;
type SpecialistPhase = FixPipelineNode["phase"];

const maxPipelineReworks = 2;

const fixPipelinePasses = [
  {
    phase: "research",
    label: "Research",
    statusMessage: "Researching project patterns and review context.",
    timeoutMs: 12 * 60_000
  },
  {
    phase: "implementation",
    label: "Implementation",
    statusMessage: "Implementing the smallest coherent fix.",
    timeoutMs: 30 * 60_000
  },
  {
    phase: "tests-qa",
    label: "Tests/QA",
    statusMessage: "Adding or updating focused tests.",
    timeoutMs: 20 * 60_000
  },
  {
    phase: "docs",
    label: "Docs",
    statusMessage: "Checking whether docs or examples need updates.",
    timeoutMs: 10 * 60_000
  },
  {
    phase: "security",
    label: "Security",
    statusMessage: "Reviewing the patch for security regressions.",
    timeoutMs: 10 * 60_000
  },
  {
    phase: "final-review",
    label: "Final review",
    statusMessage: "Reviewing the full patch before preview.",
    timeoutMs: 10 * 60_000
  }
] satisfies Array<{ phase: SpecialistPhase; label: string; statusMessage: string; timeoutMs: number }>;

type FixPipelinePass = (typeof fixPipelinePasses)[number];

export async function recoverFixJobs(): Promise<void> {
  if (recovered) return;
  recovered = true;
  const persisted = await readFixJobs();
  for (const job of persisted) {
    if (job.status !== "queued" && job.status !== "running") continue;
    const pr = parsePrKey(job.prKey);
    if (!pr) {
      update(job, interruptedJobPatch(job, "Fix session stopped and the PR identity could not be recovered."));
      continue;
    }
    fixJobs.set(job.id, job);
    if (job.status === "queued") {
      queue.push({
        job,
        request: {
          ...pr,
          instructions: job.instructions,
          source: job.source,
          baseJobId: job.baseJobId
        }
      });
      update(job, { ...clearRecoveryPatch<FixJob>(), status: "queued", phase: "queued", statusMessage: "Recovered queued Codex fix session.", error: undefined });
    } else {
      const phase = specialistPhase(job.phase);
      update(
        job,
        interruptedJobPatch(job, "Codex fix session was interrupted when MNLens stopped. Retry session to continue from the preserved workspace/context.", {
          phase: job.phase ?? "completed",
          pipeline: phase ? markPipelineFailed(job, phase, "Interrupted when MNLens stopped; retry can continue from this phase.") : job.pipeline,
          statusMessage: "Fix session interrupted."
        } as Partial<FixJob>)
      );
    }
  }
  void drainQueue();
}

function buildPipelineState(startIndex = 0): FixPipelineNode[] {
  const now = new Date().toISOString();
  return fixPipelinePasses.map((pass, index) => ({
    phase: pass.phase,
    label: pass.label,
    status: index < startIndex ? "done" : "pending",
    updatedAt: now
  }));
}

export async function enqueueFix(request: FixRequest): Promise<FixJob> {
  const job: FixJob = {
    id: randomUUID(),
    status: "queued",
    prKey: prKey(request.owner, request.repo, request.number),
    phase: "queued",
    statusMessage: "Waiting to start.",
    pipeline: buildPipelineState(),
    source: request.source?.trim() || fixSourceLabel(request.instructions),
    instructions: request.instructions?.trim() || "General fix preview requested from the Fix tab. Address concrete review findings, comments, failing checks, and test gaps.",
    baseJobId: request.baseJobId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stdout: "",
    stderr: ""
  };
  fixJobs.set(job.id, job);
  queue.push({ job, request });
  await writeFixJob(job);
  void drainQueue();
  return job;
}

function fixSourceLabel(instructions?: string): string {
  const text = instructions?.toLowerCase() ?? "";
  if (text.includes("continue the existing codex fix session")) return "Fix follow-up";
  if (text.includes("ci check") || text.includes("failing ci")) return "CI Status";
  if (text.includes("test") || text.includes("coverage")) return "Test Quality";
  if (text.includes("research source")) return "Research";
  if (text.includes("review risk")) return "Risks";
  if (text.includes("review focus")) return "Reviewer Focus";
  if (text.includes("retry the previous failed")) return "Retry session";
  if (text.includes("locally drafted reviewer comments")) return "Review comments";
  return instructions?.trim() ? "Review action" : "Fix tab";
}

export async function retryFix(id: string, instructions = ""): Promise<FixJob> {
  const previous = fixJobs.get(id) ?? (await readFixJob(id));
  if (!previous) throw new Error("Fix job not found.");
  if (previous.status !== "failed") throw new Error("Only failed fix sessions can be retried.");
  const [owner, repo, numberText] = previous.prKey.split("__");
  const number = Number(numberText);
  if (!owner || !repo || !Number.isFinite(number)) throw new Error("Could not parse PR identity from failed fix job.");
  const retryInstructions = buildRetryInstructions(previous, instructions);
  return enqueueFix({ owner, repo, number, instructions: retryInstructions, baseJobId: previous.id, source: `Retry session / ${retryStartPass(previous)}` });
}

export async function cancelFix(id: string): Promise<FixJob> {
  const job = fixJobs.get(id) ?? (await readFixJob(id));
  if (!job) throw new Error("Fix job not found.");
  if (job.status !== "queued" && job.status !== "running") return job;
  cancelledJobs.add(id);
  const queuedIndex = queue.findIndex((item) => item.job.id === id);
  if (queuedIndex >= 0) {
    queue.splice(queuedIndex, 1);
    update(job, {
      status: "failed",
      phase: job.phase,
      statusMessage: "Fix job cancelled.",
      error: "Cancelled by reviewer."
    });
    return job;
  }
  const child = activeProcesses.get(id);
  if (child && !child.killed) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (activeProcesses.get(id) === child && !child.killed) child.kill("SIGKILL");
    }, 3000);
  }
  update(job, {
    statusMessage: "Cancelling fix job.",
    error: "Cancellation requested by reviewer."
  });
  return job;
}

export async function askFixQuestion(id: string, question: string): Promise<{ job: FixJob; answer: string }> {
  const job = fixJobs.get(id) ?? (await readFixJob(id));
  if (!job) throw new Error("Fix job not found.");
  const text = question.trim();
  if (!text) throw new Error("Question is required.");
  if (job.status === "queued" || job.status === "running") {
    const now = new Date().toISOString();
    const answer = "Guidance queued for the next Codex continuation pass. The current running process cannot be interrupted through stdin safely.";
    update(job, {
      instructions: [job.instructions, text].filter(Boolean).join("\n\n"),
      conversation: [
        ...(job.conversation ?? []),
        { id: randomUUID(), role: "user", body: text, createdAt: now },
        { id: randomUUID(), role: "assistant", body: answer, createdAt: new Date().toISOString() }
      ],
      statusMessage: "Reviewer guidance queued for the next Codex continuation pass."
    });
    return { job, answer };
  }
  if (!job.repoDir || !existsSync(join(job.repoDir, ".git"))) throw new Error("Fix workspace is missing. Start a new fix preview before asking about it.");
  const token = await requireToken();
  const currentDiff = await preparedDiffSnapshot(job.repoDir).catch(() => job.diff ?? "");
  const now = new Date().toISOString();
  update(job, {
    conversation: [
      ...(job.conversation ?? []),
      { id: randomUUID(), role: "user", body: text, createdAt: now }
    ]
  });
  const args = job.codexSessionId
    ? ["exec", "resume", "--skip-git-repo-check", job.codexSessionId, "-"]
    : ["--ask-for-approval", "never", "exec", "--skip-git-repo-check", "--sandbox", "read-only", "-"];
  const result = await runStreaming(job, "codex", args, {
    cwd: job.repoDir,
    input: buildFixQuestionPrompt(job, text, currentDiff),
    env: { CODEX_HOME: codexHome, GH_TOKEN: token, GH_HOST: "github.com" },
    timeoutMs: 8 * 60_000,
    redact: [token]
  });
  const answer = extractFixAnswer(result.stdout);
  update(job, {
    codexSessionId: extractCodexSessionId(job.stdout) ?? job.codexSessionId,
    conversation: [
      ...(job.conversation ?? []),
      { id: randomUUID(), role: "assistant", body: answer, createdAt: new Date().toISOString() }
    ],
    diff: await preparedDiffSnapshot(job.repoDir).catch(() => job.diff ?? currentDiff),
    statusMessage: "Codex answered a review question without starting a new fix pipeline."
  });
  return { job, answer };
}

function buildRetryInstructions(previous: FixJob, instructions: string): string {
  const log = cleanRetryLog([previous.error, previous.stderr, previous.stdout].filter(Boolean).join("\n\n"));
  const diff = previous.diff?.trim() ? cleanRetryLog(previous.diff) : "";
  const retryPass = retryStartPass(previous);
  return `Retry the previous failed Codex fix session. First try to continue the existing workspace/session from the failed pipeline stage: ${retryPass}. Do not restart earlier completed stages unless the existing workspace/session is unavailable or clearly inconsistent. If continuation is not possible, start from a clean PR checkout and make the smallest coherent patch.

Pipeline order:
1. Research
2. Implementation
3. Tests/QA
4. Docs
5. Security
6. Final review

Resume guidance:
- If the previous failure was in Research or checkout, recover context and continue with Research.
- If the previous failure was in the Codex implementation pass, continue from Implementation and keep any useful prepared diff.
- If the previous failure was in local verification, continue from Tests/QA: inspect the failing output, fix tests or code, then rerun only relevant verification.
- If the previous failure was in commit/push/finalization, do Final review first, then retry the finalization path only after the diff is coherent.

Human retry instructions:
${instructions.trim() || "No extra retry instructions provided."}

Previous failed session:
- Job: ${previous.id}
- Status message: ${previous.statusMessage ?? "none"}
- Phase: ${previous.phase ?? "unknown"}
- Exit code: ${typeof previous.exitCode === "number" ? previous.exitCode : "unknown"}
- Workspace: ${previous.repoDir ?? "unknown"}

Previous prepared diff, if any:
${diff || "No prepared diff was captured."}

Previous session log:
${log || "No previous log was captured."}`;
}

function retryStartPass(previous: FixJob): string {
  if (previous.phase === "preparing" || previous.phase === "checking-out" || previous.phase === "research") return "Research";
  if (previous.phase === "implementation" || previous.phase === "codex") return "Implementation";
  if (previous.phase === "tests-qa" || previous.phase === "testing") return "Tests/QA";
  if (previous.phase === "docs") return "Docs";
  if (previous.phase === "security") return "Security";
  if (previous.phase === "final-review" || previous.phase === "committing" || previous.phase === "pushing") return "Final review";
  return "Final review";
}

async function pipelineStartIndex(request: FixRequest): Promise<number> {
  if (!request.baseJobId) return 0;
  const previous = fixJobs.get(request.baseJobId) ?? (await readFixJob(request.baseJobId));
  if (previous?.status !== "failed") return 0;
  const label = retryStartPass(previous);
  const index = fixPipelinePasses.findIndex((pass) => pass.label === label);
  return index >= 0 ? index : 0;
}

function cleanRetryLog(value: string): string {
  return value.length > 18_000 ? `${value.slice(0, 5_000)}\n\n[Retry context truncated]\n\n${value.slice(-12_000)}` : value;
}

function assertNotCancelled(job: FixJob): void {
  if (cancelledJobs.has(job.id)) {
    throw new CommandError("Fix job cancelled", { stdout: job.stdout, stderr: job.stderr, exitCode: null });
  }
}

function markPipelineCurrent(job: FixJob, phase: SpecialistPhase, message?: string): FixPipelineNode[] {
  const targetIndex = fixPipelinePasses.findIndex((pass) => pass.phase === phase);
  const now = new Date().toISOString();
  const existing = job.pipeline?.length ? job.pipeline : buildPipelineState();
  return existing.map((node, index) => {
    if (node.phase === phase) {
      return {
        ...node,
        status: "current",
        attempts: (node.attempts ?? 0) + 1,
        message,
        updatedAt: now
      };
    }
    if (targetIndex >= 0 && index > targetIndex && node.status !== "waiting" && node.status !== "failed") {
      return { ...node, status: "pending", updatedAt: now };
    }
    return node;
  });
}

function markPipelineDone(job: FixJob, phase: SpecialistPhase, message?: string): FixPipelineNode[] {
  const now = new Date().toISOString();
  const existing = job.pipeline?.length ? job.pipeline : buildPipelineState();
  return existing.map((node) =>
    node.phase === phase
      ? {
          ...node,
          status: "done",
          message: message ?? node.message,
          updatedAt: now
        }
      : node
  );
}

function markPipelineWaiting(job: FixJob, phase: SpecialistPhase, message: string): FixPipelineNode[] {
  const now = new Date().toISOString();
  const existing = job.pipeline?.length ? job.pipeline : buildPipelineState();
  return existing.map((node) =>
    node.phase === phase
      ? {
          ...node,
          status: "waiting",
          message,
          updatedAt: now
        }
      : node
  );
}

function markPipelineFailed(job: FixJob, phase: SpecialistPhase, message: string): FixPipelineNode[] {
  const now = new Date().toISOString();
  const existing = job.pipeline?.length ? job.pipeline : buildPipelineState();
  return existing.map((node) =>
    node.phase === phase
      ? {
          ...node,
          status: "failed",
          message,
          updatedAt: now
        }
      : node
  );
}

function pipelineReworkTarget(
  target: SpecialistPhase | undefined,
  current: SpecialistPhase,
  reworkCount: number
): { index: number; phase: SpecialistPhase; pass: FixPipelinePass } | undefined {
  if (!target || reworkCount >= maxPipelineReworks) return undefined;
  const currentIndex = fixPipelinePasses.findIndex((pass) => pass.phase === current);
  const targetIndex = fixPipelinePasses.findIndex((pass) => pass.phase === target);
  if (targetIndex < 0 || currentIndex < 0 || targetIndex >= currentIndex) return undefined;
  const pass = fixPipelinePasses[targetIndex];
  return { index: targetIndex, phase: pass.phase, pass };
}

function parsePipelineDirective(output: string): { action: "continue" } | { action: "rework"; target: SpecialistPhase } | undefined {
  const matches = [...output.matchAll(/PRA_PIPELINE:\s*(continue|rework)\s*([a-z-]+)?/gi)];
  const match = matches[matches.length - 1];
  if (!match) return undefined;
  if (match[1].toLowerCase() === "continue") return { action: "continue" };
  const target = match[2]?.toLowerCase();
  const pass = fixPipelinePasses.find((item) => item.phase === target);
  return pass ? { action: "rework", target: pass.phase } : undefined;
}

function extractQaSummary(
  output: string,
  failures: string[],
  directive: { action: "continue" } | { action: "rework"; target: SpecialistPhase } | undefined
): string {
  const marker = /QA_VERIFICATION_SUMMARY:\s*([\s\S]*?)(?:\n\s*PRA_PIPELINE:|$)/i.exec(output);
  const summary = marker?.[1]?.trim();
  if (summary) return cleanSummary(summary);
  const action =
    directive?.action === "rework"
      ? `QA requested ${pipelineLabel(directive.target)} rework.`
      : "QA chose to continue and surface the failure context for human review.";
  const failureText = failures.length > 0 ? ` Verification failure: ${failures[0]}` : "";
  return cleanSummary(`${action}${failureText}`);
}

function cleanSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 700);
}

function pipelineLabel(phase: SpecialistPhase): string {
  return fixPipelinePasses.find((pass) => pass.phase === phase)?.label ?? phase;
}

function extractFixAnswer(output: string): string {
  const marker = /FIX_ANSWER:\s*([\s\S]*)/i.exec(output);
  const answer = marker?.[1]?.trim() || output.trim();
  return answer.replace(/\s+\n/g, "\n").trim().slice(0, 2_500);
}

function specialistPhase(value: FixPipelinePhase | undefined): SpecialistPhase | undefined {
  return fixPipelinePasses.find((pass) => pass.phase === value)?.phase;
}

export async function getFixJob(id: string): Promise<FixJob | undefined> {
  const job = fixJobs.get(id) ?? (await readFixJob(id));
  if (!job) return undefined;
  if (!job.codexSessionId) {
    const codexSessionId = extractCodexSessionId(job.stdout);
    if (codexSessionId) update(job, { codexSessionId });
  }
  if (!fixJobs.has(job.id) && (job.status === "queued" || job.status === "running")) {
    const phase = specialistPhase(job.phase);
    update(
      job,
      interruptedJobPatch(job, "Fix worker stopped before this job completed. Retry session to continue from the preserved workspace/context.", {
        phase: job.phase ?? "completed",
        pipeline: phase ? markPipelineFailed(job, phase, "Interrupted when MNLens stopped; retry can continue from this phase.") : job.pipeline,
        statusMessage: "Fix session interrupted."
      } as Partial<FixJob>)
    );
  }
  return job;
}

export async function getFixLiveDiff(id: string): Promise<{ id: string; diff: string; repoDir?: string; updatedAt: string }> {
  const job = fixJobs.get(id) ?? (await readFixJob(id));
  if (!job) throw new Error("Fix job not found.");
  if (!job.repoDir || !existsSync(join(job.repoDir, ".git"))) {
    return { id: job.id, diff: job.committed || job.pushed ? "" : (job.diff ?? ""), repoDir: job.repoDir, updatedAt: job.updatedAt };
  }
  const diff = await preparedDiffSnapshot(job.repoDir);
  if (diff !== (job.diff ?? "")) {
    update(job, { diff, committed: diff.trim() ? false : job.committed });
  }
  return { id: job.id, diff, repoDir: job.repoDir, updatedAt: job.updatedAt };
}

export async function listFixJobs(key: string): Promise<FixJob[]> {
  const persisted = await readFixJobsForPr(key);
  const byId = new Map<string, FixJob>();
  for (const job of persisted) {
    if (!job.codexSessionId) {
      const codexSessionId = extractCodexSessionId(job.stdout);
      if (codexSessionId) job.codexSessionId = codexSessionId;
    }
    await refreshPreparedDiff(job);
    byId.set(job.id, job);
  }
  for (const job of fixJobs.values()) {
    await refreshPreparedDiff(job);
    if (job.prKey === key) byId.set(job.id, job);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listActiveFixJobs(): Promise<FixJob[]> {
  const persisted = await readFixJobs();
  const byId = new Map<string, FixJob>();
  for (const job of persisted) {
    if (job.status === "queued" || job.status === "running") {
      if (!fixJobs.has(job.id)) {
        const phase = specialistPhase(job.phase);
        Object.assign(
          job,
          interruptedJobPatch(job, "Fix worker stopped before this job completed. Retry session to continue from the preserved workspace/context.", {
            phase: job.phase ?? "completed",
            pipeline: phase ? markPipelineFailed(job, phase, "Interrupted when MNLens stopped; retry can continue from this phase.") : job.pipeline,
            statusMessage: "Fix session interrupted."
          } as Partial<FixJob>)
        );
        await writeFixJob(job);
      }
      await refreshPreparedDiff(job);
      byId.set(job.id, job);
    }
  }
  for (const job of fixJobs.values()) {
    if (job.status === "queued" || job.status === "running") {
      await refreshPreparedDiff(job);
      byId.set(job.id, job);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function refreshPreparedDiff(job: FixJob): Promise<void> {
  if (job.committed || job.pushed) {
    if (job.diff) update(job, { diff: "" });
    return;
  }
  if (!job.repoDir || !existsSync(join(job.repoDir, ".git"))) return;
  const diff = await preparedDiffSnapshot(job.repoDir).catch(() => job.diff ?? "");
  if (diff !== (job.diff ?? "")) update(job, { diff, committed: diff.trim() ? false : job.committed });
}

export async function pushFix(id: string): Promise<FixJob> {
  const job = fixJobs.get(id) ?? (await readFixJob(id));
  if (!job) throw new Error("Fix job not found.");
  if (job.status === "queued" || job.status === "running") throw new Error("Fix preview must finish before it can be pushed.");
  if (job.pushed) return job;
  if (!job.repoDir || !existsSync(join(job.repoDir, ".git"))) throw new Error("Fix workspace is missing. Start a new fix preview.");
  const currentDiff = await preparedDiffSnapshot(job.repoDir);
  update(job, { diff: currentDiff, committed: currentDiff.trim() ? false : job.committed });
  if (!currentDiff.trim()) throw new Error("There are no uncommitted prepared code changes to push.");
  const authorshipWarnings = authorshipMetadataWarnings(currentDiff);
  if (authorshipWarnings.length > 0) {
    throw new Error(`Prepared changes modify authorship metadata incorrectly. Fix these before pushing:\n${authorshipWarnings.join("\n")}`);
  }
  const hasWorkingChanges = await hasWorkingTreeChanges(job.repoDir);
  const token = await requireToken();
  const started = Date.now();
  try {
    update(job, { status: "running", phase: "committing", statusMessage: hasWorkingChanges ? "Committing approved Codex fixes." : "Using existing local Codex commit." });
    let sha = await runStreaming(job, "git", ["rev-parse", "--short", "HEAD"], { cwd: job.repoDir, redact: [token] });
    const detail = await readPrDetail(job.prKey).catch(() => undefined);
    const commitMessage = buildApprovedFixCommitMessage(job, currentDiff, detail);
    if (hasWorkingChanges) {
      await runStreaming(job, "git", ["add", "-A"], { cwd: job.repoDir, redact: [token] });
      await runStreaming(job, "git", ["commit", "-m", commitMessage.subject, "-m", commitMessage.body], { cwd: job.repoDir, redact: [token] });
      sha = await runStreaming(job, "git", ["rev-parse", "--short", "HEAD"], { cwd: job.repoDir, redact: [token] });
    } else {
      update(job, { statusMessage: "Updating approved Codex commit message." });
      await runStreaming(job, "git", ["commit", "--amend", "-m", commitMessage.subject, "-m", commitMessage.body], { cwd: job.repoDir, redact: [token] });
      sha = await runStreaming(job, "git", ["rev-parse", "--short", "HEAD"], { cwd: job.repoDir, redact: [token] });
    }
    update(job, { committed: true, diff: "", commitSha: commandOutput(sha.stdout).trim(), phase: "pushing", statusMessage: "Pushing approved fixes to the PR branch." });
    await runStreaming(job, "git", ["push"], {
      cwd: job.repoDir,
      env: { GH_TOKEN: token, GH_HOST: "github.com" },
      timeoutMs: 10 * 60_000,
      redact: [token]
    });
    update(job, {
      status: "done",
      phase: "completed",
      statusMessage: "Approved fixes pushed.",
      pushed: true,
      diff: "",
      pushedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: (job.durationMs ?? 0) + Date.now() - started
    });
    return job;
  } catch (error) {
    const remainingDiff =
      job.repoDir && existsSync(join(job.repoDir, ".git"))
        ? await preparedDiffSnapshot(job.repoDir).catch(() => job.diff ?? "")
        : job.diff ?? "";
    update(job, {
      status: "failed",
      phase: job.phase ?? "pushing",
      statusMessage: "Push failed.",
      diff: remainingDiff,
      ...errorResult(error),
      completedAt: new Date().toISOString(),
      durationMs: (job.durationMs ?? 0) + Date.now() - started
    });
    return job;
  }
}

async function drainQueue(): Promise<void> {
  while (activeFixWorkers < Math.max(1, maxConcurrentFixSessions)) {
    const index = queue.findIndex((candidate) => !isPrFixRunning(candidate.job.prKey));
    if (index < 0) return;
    const [item] = queue.splice(index, 1);
    activeFixWorkers += 1;
    void runFixQueueItem(item).finally(() => {
      activeFixWorkers = Math.max(0, activeFixWorkers - 1);
      void drainQueue();
    });
  }
}

function isPrFixRunning(prKeyValue: string): boolean {
  return [...fixJobs.values()].some((job) => job.prKey === prKeyValue && job.status === "running");
}

async function runFixQueueItem(item: { job: FixJob; request: FixRequest }): Promise<void> {
  const started = Date.now();
  update(item.job, { status: "running", phase: "preparing", startedAt: new Date(started).toISOString(), statusMessage: "Preparing fix workspace." } as Partial<FixJob>);
  try {
      await ensureCodexHome();
      const token = await requireToken();
      const detail = await getPrDetail(item.request.owner, item.request.repo, item.request.number);
      const analysis = await readAnalysis(detail.key);
      const workspace = await prepareWorkspace(item.request, token, item.job);
      const startPassIndex = await pipelineStartIndex(item.request);
      const firstPass = fixPipelinePasses[startPassIndex] ?? fixPipelinePasses[0];
      update(item.job, {
        repoDir: workspace.repoDir,
        codexSessionId: workspace.codexSessionId,
        pipeline: buildPipelineState(startPassIndex),
        phase: firstPass.phase,
        statusMessage: workspace.reused ? "Codex is continuing the existing fix session." : "Codex is starting the specialist fix pipeline."
      });
      let testFailures: string[] = [];
      let pipelineIndex = startPassIndex;
      let reworkCount = 0;

      while (pipelineIndex < fixPipelinePasses.length) {
        const pass = fixPipelinePasses[pipelineIndex];
        assertNotCancelled(item.job);
        const currentDiff = await preparedDiffSnapshot(workspace.repoDir).catch(() => item.job.diff ?? workspace.currentDiff);
        update(item.job, {
          phase: pass.phase,
          diff: currentDiff,
          pipeline: markPipelineCurrent(item.job, pass.phase, pass.statusMessage),
          statusMessage: `${pass.statusMessage} ${workspace.reused || item.job.codexSessionId ? "Continuing the current Codex session." : "Starting a Codex session."}`
        });
        const prompt = buildPhasePrompt(pass, detail, analysis, item.request, item.job, currentDiff);
        const sessionId = item.job.codexSessionId ?? workspace.codexSessionId;
        const codexArgs = sessionId
          ? ["exec", "resume", "--skip-git-repo-check", sessionId, "-"]
          : ["--ask-for-approval", "never", "exec", "--skip-git-repo-check", "--sandbox", "danger-full-access", "-"];
        const result = await runStreaming(item.job, "codex", codexArgs, {
          cwd: workspace.repoDir,
          input: prompt,
          env: { CODEX_HOME: codexHome, GH_TOKEN: token, GH_HOST: "github.com" },
          timeoutMs: pass.timeoutMs,
          redact: [token]
        });
        const codexSessionId = extractCodexSessionId(item.job.stdout) ?? item.job.codexSessionId ?? workspace.codexSessionId;
        update(item.job, {
          codexSessionId,
          diff: await preparedDiffSnapshot(workspace.repoDir).catch(() => item.job.diff ?? currentDiff),
          pipeline: markPipelineDone(item.job, pass.phase)
        });

        let directive = parsePipelineDirective(result.stdout);
        if (pass.phase === "tests-qa") {
          const latestFailures: string[] = [];
          update(item.job, { phase: "tests-qa", pipeline: markPipelineCurrent(item.job, "tests-qa", "Running inferred verification commands."), statusMessage: "Running inferred verification commands." });
          for (const command of runnableCommands(analysis?.testsToCheck ?? [])) {
            const parsed = parseCommand(command);
            if (parsed) {
              const resolved = await resolveFixGradleProjectCommand(item.job, workspace.repoDir, parsed, token);
              try {
                await runStreaming(item.job, resolved.command, resolved.args, {
                  cwd: workspace.repoDir,
                  env: { GH_TOKEN: token, GH_HOST: "github.com" },
                  timeoutMs: fixVerificationTimeoutMs,
                  redact: [token]
                });
              } catch (error) {
                latestFailures.push(error instanceof Error ? error.message : String(error));
                update(item.job, {
                  statusMessage: `Verification failed, continuing preview: ${resolved.command} ${resolved.args.join(" ")}`.trim()
                });
              }
            }
          }
          testFailures = latestFailures;
          if (latestFailures.length > 0) {
            const failureDiff = await preparedDiffSnapshot(workspace.repoDir).catch(() => item.job.diff ?? currentDiff);
            update(item.job, {
              diff: failureDiff,
              qaFailures: latestFailures,
              qaSummary: "Local verification failed. Tests/QA is checking whether this is a real implementation issue, a test issue, or an environmental failure.",
              pipeline: markPipelineCurrent(item.job, "tests-qa", "QA is deciding whether verification failures require implementation rework."),
              statusMessage: "Tests/QA is assessing verification failures before deciding whether to send work back."
            });
            const assessmentSessionId = item.job.codexSessionId ?? codexSessionId;
            const assessmentArgs = assessmentSessionId
              ? ["exec", "resume", "--skip-git-repo-check", assessmentSessionId, "-"]
              : ["--ask-for-approval", "never", "exec", "--skip-git-repo-check", "--sandbox", "danger-full-access", "-"];
            const assessment = await runStreaming(item.job, "codex", assessmentArgs, {
              cwd: workspace.repoDir,
              input: buildVerificationAssessmentPrompt(detail, analysis, item.request, item.job, failureDiff, latestFailures),
              env: { CODEX_HOME: codexHome, GH_TOKEN: token, GH_HOST: "github.com" },
              timeoutMs: 10 * 60_000,
              redact: [token]
            });
            directive = parsePipelineDirective(assessment.stdout) ?? directive;
            const qaSummary = extractQaSummary(assessment.stdout, latestFailures, directive);
            update(item.job, {
              codexSessionId: extractCodexSessionId(item.job.stdout) ?? item.job.codexSessionId ?? codexSessionId,
              diff: await preparedDiffSnapshot(workspace.repoDir).catch(() => item.job.diff ?? failureDiff),
              qaSummary,
              qaFailures: latestFailures,
              pipeline: markPipelineDone(item.job, "tests-qa", directive?.action === "rework" ? "QA requested rework after checking verification failures." : "QA decided to continue with verification failure context.")
            });
          } else {
            update(item.job, { qaSummary: undefined, qaFailures: [], pipeline: markPipelineDone(item.job, "tests-qa", "Verification passed or no runnable command was inferred.") });
          }
        }

        const reworkTarget = directive?.action === "rework" ? pipelineReworkTarget(directive.target, pass.phase, reworkCount) : undefined;
        if (reworkTarget) {
          reworkCount += 1;
          update(item.job, {
            phase: reworkTarget.phase,
            pipeline: markPipelineWaiting(item.job, pass.phase, `Waiting for ${reworkTarget.pass.label} rework requested by ${pass.label} (${reworkCount}/${maxPipelineReworks}).`),
            statusMessage: `${pass.label} requested ${reworkTarget.pass.label} rework (${reworkCount}/${maxPipelineReworks}).`
          });
          pipelineIndex = reworkTarget.index;
          continue;
        }
        pipelineIndex += 1;
      }

      const diff = await preparedDiff(item.job, workspace.repoDir, token);
      const authorshipWarnings = authorshipMetadataWarnings(diff);
      const readyMessage = diff.trim()
        ? authorshipWarnings.length > 0
          ? "Fix preview ready; authorship metadata needs review."
          : testFailures.length > 0
          ? "Fix preview ready; verification failed."
          : "Fix preview ready for human review."
        : testFailures.length > 0
          ? "No code changes; verification failed."
          : "Codex did not make file changes.";
      update(item.job, {
        diff,
        committed: false,
        pushed: false,
        error: [...authorshipWarnings.map((line) => `Authorship metadata issue: ${line}`), ...testFailures].join("\n") || undefined,
        statusMessage: readyMessage
      });

      update(item.job, {
        status: "done",
        phase: "completed",
        statusMessage: readyMessage,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started
      });
  } catch (error) {
    const cancelled = cancelledJobs.has(item.job.id);
    const failedPhase = specialistPhase(item.job.phase);
    update(item.job, {
      status: "failed",
      phase: item.job.phase,
      pipeline: failedPhase ? markPipelineFailed(item.job, failedPhase, cancelled ? "Fix job cancelled." : "Phase failed before the preview could finish.") : item.job.pipeline,
      statusMessage: cancelled ? "Fix job cancelled." : "Fix job failed.",
      codexSessionId: extractCodexSessionId(item.job.stdout) ?? item.job.codexSessionId,
      ...(cancelled ? { error: "Cancelled by reviewer." } : errorResult(error)),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started
    });
    cancelledJobs.delete(item.job.id);
  }
}

async function prepareWorkspace(
  request: FixRequest,
  token: string,
  job: FixJob
): Promise<{ repoDir: string; reused: boolean; codexSessionId?: string; currentDiff: string }> {
  const prDir = join(root, prKey(request.owner, request.repo, request.number));
  const repoDir = join(prDir, job.id);
  const repoName = `${request.owner}/${request.repo}`;
  await mkdir(prDir, { recursive: true });
  if (request.baseJobId) {
    const baseJob = fixJobs.get(request.baseJobId) ?? (await readFixJob(request.baseJobId));
    if (baseJob?.repoDir && existsSync(join(baseJob.repoDir, ".git"))) {
      const currentDiff = await preparedDiffSnapshot(baseJob.repoDir).catch(() => baseJob.diff ?? "");
      update(job, {
        phase: "checking-out",
        statusMessage: `Reusing existing fix workspace from ${request.baseJobId.slice(0, 8)}.`,
        repoDir: baseJob.repoDir,
        codexSessionId: baseJob.codexSessionId,
        diff: currentDiff
      });
      return { repoDir: baseJob.repoDir, reused: true, codexSessionId: baseJob.codexSessionId, currentDiff };
    }
  }
  await rm(repoDir, { recursive: true, force: true });
  update(job, { phase: "checking-out", statusMessage: `Cloning a clean ${repoName} workspace.` });
  await runStreaming(job, "gh", ["repo", "clone", repoName, repoDir], {
    env: { GH_TOKEN: token, GH_HOST: "github.com" },
    timeoutMs: 10 * 60_000,
    redact: [token]
  });
  update(job, { phase: "checking-out", statusMessage: `Checking out PR #${request.number}.` });
  await runStreaming(job, "gh", ["pr", "checkout", String(request.number)], {
    cwd: repoDir,
    env: { GH_TOKEN: token, GH_HOST: "github.com" },
    timeoutMs: 5 * 60_000,
    redact: [token]
  });
  return { repoDir, reused: false, currentDiff: "" };
}

function buildPhasePrompt(
  pass: (typeof fixPipelinePasses)[number],
  detail: PrDetail,
  analysis: unknown,
  request: FixRequest,
  job: FixJob,
  currentDiff: string
): string {
  const context = buildFixContext(detail, analysis, request);
  const continuation = job.codexSessionId
    ? `Continue Codex session ${job.codexSessionId}. Preserve useful existing changes in the working tree.`
    : "This is the first Codex pass for this fix session.";
  return `${context}

Current pipeline phase: ${pass.label}
${continuation}

Current uncommitted or unpushed prepared diff:
${currentDiff.trim() || "No prepared diff is present yet."}

Phase instructions:
${phaseInstructions(pass.phase)}

Gradle command policy:
- In multi-project Gradle repositories, do not guess project paths. Inspect \`settings.gradle\`, \`settings.gradle.kts\`, or run \`./gradlew projects\` before adding or relying on module-scoped Gradle commands.
- Use the exact included project path that owns the changed file path. Quote wildcard \`--tests\` patterns, for example \`--tests '*ExampleSpec'\`.

Pipeline control:
- If this phase can continue forward, end your response with exactly: PRA_PIPELINE: continue
- If this phase found a concrete problem that must be fixed by an earlier phase before review can continue, end with exactly one of:
  PRA_PIPELINE: rework implementation
  PRA_PIPELINE: rework tests-qa
  PRA_PIPELINE: rework docs
  PRA_PIPELINE: rework security
- Only request rework for an earlier phase when there is a concrete issue. The runner has a bounded rework budget and will continue with visible failure context rather than loop forever.

At the end of this phase, leave a concise note in your response for this phase only. Do not commit or push.`;
}

function buildVerificationAssessmentPrompt(
  detail: PrDetail,
  analysis: unknown,
  request: FixRequest,
  job: FixJob,
  currentDiff: string,
  failures: string[]
): string {
  return `${buildFixContext(detail, analysis, request)}

Current pipeline phase: Tests/QA verification assessment
Continue Codex session ${job.codexSessionId ?? "unknown"}. Do not make broad changes in this assessment pass.

The runner executed local verification after the Tests/QA pass and captured these failures:
${failures.map((failure, index) => `${index + 1}. ${failure}`).join("\n") || "No failure text was captured."}

Current uncommitted or unpushed prepared diff:
${currentDiff.trim() || "No prepared diff is present yet."}

Decide whether the verification failure proves that an earlier phase must rework the patch.
- Request rework only if the failure is likely caused by the current prepared changes or a missing test/code/docs/security fix.
- Continue if the failure is unrelated, flaky, environmental, caused by unavailable dependencies/services, or already explained well enough for human review.
- If rework is needed, pick the earliest phase that should handle it.

Pipeline control:
- Before the pipeline marker, include one short line starting with:
  QA_VERIFICATION_SUMMARY: <why verification failed and whether it appears caused by this patch, test setup, or environment>
- End with exactly one of:
  PRA_PIPELINE: continue
  PRA_PIPELINE: rework implementation
  PRA_PIPELINE: rework docs
  PRA_PIPELINE: rework security

Leave a concise QA judgment explaining why you chose that pipeline action. Do not commit or push.`;
}

function buildFixQuestionPrompt(job: FixJob, question: string, currentDiff: string): string {
  const recentConversation = (job.conversation ?? [])
    .slice(-8)
    .map((message) => `${message.role}: ${message.body}`)
    .join("\n\n");
  return `You are Codex answering a reviewer question about an existing Fix session.

This is explanation-only. Do not edit files, run broad commands, commit, push, or start a new fix pipeline.
If the reviewer is asking for code changes, explain what would need to change and say they should use Request changes.

Fix session:
${JSON.stringify({ id: job.id, source: job.source, status: job.status, phase: job.phase, statusMessage: job.statusMessage, qaSummary: job.qaSummary }, null, 2)}

Recent conversation:
${recentConversation || "No previous fix conversation."}

Current prepared diff:
${currentDiff.trim() || "No prepared diff is present."}

Reviewer question:
${question}

Start your answer with:
FIX_ANSWER:

Keep the answer concise and directly tied to the current prepared changes.`;
}

function phaseInstructions(phase: FixPipelinePhase): string {
  if (phase === "research") {
    return `- Inspect the repository patterns, existing modules, PR comments, and AI analysis before editing.
- Prefer read-only investigation in this phase.
- Only edit if a tiny metadata/context correction is required to unblock later phases.
- Identify the concrete issues that Implementation and Tests/QA should address.`;
  }
  if (phase === "implementation") {
    return `- Make the smallest coherent code/configuration changes that address concrete reviewer comments, failing checks, and high-confidence AI findings.
- Do not broaden the PR scope or rewrite unrelated code.
- If this is a Vulnerability Audit/CVE fix, trace the dependency tree and update the root dependency, BOM, or platform that brings the vulnerable transitive dependency first; add a direct fixed transitive version only as a last resort with a clear reason.
- Preserve existing authorship metadata in existing files and do not invent authorship metadata in new files.`;
  }
  if (phase === "tests-qa") {
    return `- Add or update focused tests that would fail before the fix and pass after it.
- Prioritize edge cases directly connected to source-code behavior, lifecycle, security, dependency, or compatibility risks.
- Keep test-only maintainability cleanup small and label it as test-only in your summary.
- If no test change is justified, explain why existing coverage is enough and name the commands that should pass.`;
  }
  if (phase === "docs") {
    return `- Update docs, examples, migration notes, or configuration snippets only when user-facing behavior, setup, dependency usage, or terminology changed.
- Keep docs concise and aligned with project style.
- If no docs are needed, say so and do not edit files.`;
  }
  if (phase === "security") {
    return `- Review the current diff for auth, secret handling, injection, unsafe shell/process execution, permissions, dependency/CVE, and data exposure risks.
- Make focused fixes only for concrete security issues introduced or exposed by this patch.
- For dependency vulnerabilities, update the owning platform/root dependency first; avoid pinning random transitives unless there is no better root-level update.`;
  }
  if (phase === "final-review") {
    return `- Inspect the complete prepared diff as a final reviewer.
- Remove speculative, unrelated, or over-broad changes.
- Verify the patch still addresses existing PR comments and human follow-up instructions.
- Do not start new feature work. Leave a final summary and expected verification commands.`;
  }
  return "- Continue the fix conservatively and keep the patch reviewable.";
}

function buildFixContext(detail: PrDetail, analysis: unknown, request: FixRequest): string {
  const conversationComments = (detail.conversationComments ?? []).map((comment) => ({
    body: comment.body,
    author: comment.author,
    createdAt: comment.createdAt,
    url: comment.url
  }));
  const reviewSummaries = (detail.reviewSummaries ?? []).map((review) => ({
    state: review.state,
    body: review.body,
    author: review.author,
    submittedAt: review.createdAt,
    url: review.url
  }));
  const inlineReviewComments = (detail.reviewComments ?? []).map((comment) => ({
    path: comment.path,
    line: comment.line ?? comment.originalLine,
    side: comment.side,
    body: comment.body,
    author: comment.author,
    createdAt: comment.createdAt,
    url: comment.url
  }));
  const draftComments = (request.draftComments ?? [])
    .filter((comment) => comment.body.trim().length > 0)
    .map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      body: comment.body
  }));
  return `You are Codex fixing a GitHub PR after human/AI review.

Goal:
- Address all concrete issues in the analysis and existing PR comments.
- Consider GitHub conversation comments, review summary comments, inline review comments, and any locally drafted reviewer comments.
- Treat reviewer comments as higher priority than AI suggestions when they conflict.
- Add or update tests so the fixed behavior is covered.
- Keep the patch focused. Do not rewrite unrelated code.
- Preserve existing authorship metadata in existing files. Do not remove or rewrite existing @author, copyright owner, maintainer, or generated-by lines unless a reviewer explicitly asks for that exact cleanup.
- Do not invent authorship metadata for new files. New files should not include @author lines unless an existing file template in the same package/module requires it and the exact value is already present in that template.
- If an existing template requires an @author tag for a new file but the correct human author is not known from that template, omit the tag instead of guessing from the PR author or comments.
- After edits, summarize what changed and which tests should pass.
- Do not commit or push. The human reviewer must inspect the diff first.
${request.instructions?.trim() ? `\nHuman follow-up instructions from the fix session log:\n${request.instructions.trim()}\n` : ""}

PR:
${JSON.stringify({ repository: detail.repository, number: detail.number, title: detail.title, body: detail.body, linkedIssues: detail.linkedIssues ?? [], files: detail.files }, null, 2)}

Existing PR conversation comments:
${JSON.stringify(conversationComments, null, 2)}

Existing review summary comments:
${JSON.stringify(reviewSummaries, null, 2)}

Existing inline review comments:
${JSON.stringify(inlineReviewComments, null, 2)}

Locally drafted reviewer comments not yet posted:
${JSON.stringify(draftComments, null, 2)}

Actionable AI analysis:
${JSON.stringify(compactFixAnalysis(analysis), null, 2)}
`;
}

function compactFixAnalysis(analysis: unknown): unknown {
  if (!analysis || typeof analysis !== "object") return analysis;
  const source = analysis as Record<string, unknown>;
  return {
    type: source.type,
    summary: source.summary,
    behaviorBefore: source.behaviorBefore,
    behaviorAfter: source.behaviorAfter,
    reviewerFocus: source.reviewerFocusDetails ?? source.reviewerFocus,
    risks: source.riskDetails ?? source.risks,
    evidence: source.evidenceDetails ?? source.evidence,
    testsToCheck: source.testsToCheck,
    testAssessment: source.testAssessment,
    draftComment: source.draftComment,
    caveats: source.caveats
  };
}

function extractCodexSessionId(output: string): string | undefined {
  return /session id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(output)?.[1];
}

async function preparedDiff(job: FixJob, repoDir: string, token: string): Promise<string> {
  const status = await runStreaming(job, "git", ["status", "--porcelain"], { cwd: repoDir, redact: [token] });
  const unpushed = await unpushedDiff(job, repoDir, token);
  if (!status.stdout.trim()) return unpushed;
  const stagedDiff = await runStreaming(job, "git", ["diff", "--cached", "--", "."], { cwd: repoDir, redact: [token] });
  const diff = await runStreaming(job, "git", ["diff", "--", "."], { cwd: repoDir, redact: [token] });
  const untracked = (await runStreaming(job, "git", ["ls-files", "--others", "--exclude-standard"], { cwd: repoDir, redact: [token] })).stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (untracked.length === 0) return [unpushed, commandOutput(stagedDiff.stdout), commandOutput(diff.stdout)].filter(Boolean).join("\n");
  const untrackedDiffs: string[] = [];
  for (const file of untracked.slice(0, 20)) {
    const fileDiff = await runStreaming(job, "git", ["diff", "--no-index", "--", "/dev/null", file], { cwd: repoDir, redact: [token] }).catch(
      (error) => (error instanceof CommandError ? error.result : undefined)
    );
    if (fileDiff?.stdout) untrackedDiffs.push(fileDiff.stdout);
  }
  return [unpushed, commandOutput(stagedDiff.stdout), commandOutput(diff.stdout), ...untrackedDiffs.map(commandOutput)].filter(Boolean).join("\n");
}

async function preparedDiffSnapshot(repoDir: string): Promise<string> {
  const status = await runCommand("git", ["status", "--porcelain"], { cwd: repoDir });
  const unpushed = await unpushedDiffSnapshot(repoDir);
  if (!status.stdout.trim()) return unpushed;
  const stagedDiff = await runCommand("git", ["diff", "--cached", "--", "."], { cwd: repoDir });
  const diff = await runCommand("git", ["diff", "--", "."], { cwd: repoDir });
  const untracked = (await runCommand("git", ["ls-files", "--others", "--exclude-standard"], { cwd: repoDir })).stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (untracked.length === 0) return [unpushed, stagedDiff.stdout, diff.stdout].filter(Boolean).join("\n");
  const untrackedDiffs: string[] = [];
  for (const file of untracked.slice(0, 20)) {
    const fileDiff = await runCommand("git", ["diff", "--no-index", "--", "/dev/null", file], { cwd: repoDir }).catch((error) =>
      error instanceof CommandError ? error.result : undefined
    );
    if (fileDiff?.stdout) untrackedDiffs.push(fileDiff.stdout);
  }
  return [unpushed, stagedDiff.stdout, diff.stdout, ...untrackedDiffs.map((item) => item)].filter(Boolean).join("\n");
}

async function hasWorkingTreeChanges(repoDir: string): Promise<boolean> {
  return Boolean((await runCommand("git", ["status", "--porcelain"], { cwd: repoDir })).stdout.trim());
}

async function unpushedDiff(job: FixJob, repoDir: string, token: string): Promise<string> {
  const upstream = await runStreaming(job, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd: repoDir, redact: [token] }).catch(
    () => undefined
  );
  const upstreamRef = upstream ? commandOutput(upstream.stdout).trim() : "";
  if (!upstreamRef) return "";
  const ahead = await runStreaming(job, "git", ["rev-list", "--count", `${upstreamRef}..HEAD`], { cwd: repoDir, redact: [token] }).catch(() => undefined);
  if (!ahead || Number(commandOutput(ahead.stdout).trim()) <= 0) return "";
  const diff = await runStreaming(job, "git", ["diff", `${upstreamRef}..HEAD`, "--", "."], { cwd: repoDir, redact: [token] });
  return commandOutput(diff.stdout);
}

async function unpushedDiffSnapshot(repoDir: string): Promise<string> {
  const upstream = await runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd: repoDir }).catch(() => undefined);
  const upstreamRef = upstream?.stdout.trim() ?? "";
  if (!upstreamRef) return "";
  const ahead = await runCommand("git", ["rev-list", "--count", `${upstreamRef}..HEAD`], { cwd: repoDir }).catch(() => undefined);
  if (!ahead || Number(ahead.stdout.trim()) <= 0) return "";
  return (await runCommand("git", ["diff", `${upstreamRef}..HEAD`, "--", "."], { cwd: repoDir })).stdout;
}

function commandOutput(stdout: string): string {
  return stdout.replace(/^\$ [^\n]*\n/, "");
}

function buildApprovedFixCommitMessage(job: FixJob, diff: string, detail?: PrDetail): { subject: string; body: string } {
  const files = changedFilesFromDiff(diff);
  const category = commitCategory(job, files);
  const title = detail?.title ? compactCommitText(detail.title, 34) : "PR review";
  const subject = compactCommitText(`${category} ${title}`, 72);
  const fileSummary = files.length > 0 ? files.slice(0, 8).join("\n- ") : "No changed files listed.";
  const body = [
    "Prepared from an approved MNLens Codex fix session.",
    "",
    `Source: ${job.source ?? "Codex Fix Session"}`,
    job.instructions ? `Intent: ${compactCommitText(job.instructions, 240)}` : undefined,
    "",
    "Changed files:",
    files.length > 0 ? `- ${fileSummary}` : "- No changed files listed.",
    files.length > 8 ? `- ...and ${files.length - 8} more` : undefined,
    "",
    "Co-authored-by: Codex <codex@openai.com>"
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
  return { subject, body };
}

function commitCategory(job: FixJob, files: string[]): string {
  const source = `${job.source ?? ""} ${job.instructions ?? ""}`.toLowerCase();
  if (source.includes("ci status") || source.includes("failing ci") || source.includes("ci check")) return "Fix CI feedback for";
  if (files.length > 0 && files.every(isDocsFile)) return "Update docs for";
  if (files.length > 0 && files.every(isTestFile)) return "Improve tests for";
  if (source.includes("test quality") || source.includes("coverage")) return "Improve test coverage for";
  if (source.includes("research")) return "Apply research feedback for";
  if (source.includes("risk")) return "Address review risk for";
  if (source.includes("comment")) return "Address review comments for";
  return "Address review feedback for";
}

function changedFilesFromDiff(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (!match) continue;
    const path = match[2] === "/dev/null" ? match[1] : match[2];
    if (!files.includes(path)) files.push(path);
  }
  return files;
}

function isDocsFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.startsWith("docs/") || lower.startsWith("src/main/docs/") || /\.(adoc|md|rst|txt)$/.test(lower);
}

function isTestFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes("/src/test/") || lower.includes("/test/") || /(?:test|spec)\.(java|groovy|kt|js|ts|tsx)$/.test(lower);
}

function compactCommitText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}`;
}

function authorshipMetadataWarnings(diff: string): string[] {
  const warnings: string[] = [];
  let currentFile = "";
  let newFile = false;
  let deletedFile = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      currentFile = "";
      newFile = false;
      deletedFile = false;
      continue;
    }
    if (line.startsWith("new file mode ")) newFile = true;
    if (line.startsWith("deleted file mode ")) deletedFile = true;
    if (line.startsWith("+++ b/")) currentFile = line.slice("+++ b/".length);
    if (line.startsWith("+++ /dev/null")) deletedFile = true;
    if (line.startsWith("--- /dev/null")) newFile = true;
    if (line.startsWith("+") && !line.startsWith("+++") && /@author\b/i.test(line)) {
      const added = line.slice(1).trim();
      if (newFile) warnings.push(`${currentFile || "new file"} adds @author metadata: ${added}`);
      else warnings.push(`${currentFile || "existing file"} adds new @author metadata: ${added}`);
    }
    if (line.startsWith("-") && !line.startsWith("---") && /@author\b/i.test(line) && !deletedFile) {
      const removed = line.slice(1).trim();
      warnings.push(`${currentFile || "existing file"} removes existing @author metadata: ${removed}`);
    }
  }
  return warnings.slice(0, 20);
}

function runnableCommands(items: string[]): string[] {
  return [...new Set(items.map((item) => extractCommand(item)).filter((item): item is string => Boolean(item)))].slice(0, 4);
}

function extractCommand(text: string): string | undefined {
  let value = text.trim();
  const inline = /`([^`]+)`/.exec(value);
  if (inline) value = inline[1].trim();
  const match = /((?:\.\/)?(?:gradlew|mvnw)\b[^\n]*|(?:gradle|mvn|npm|pnpm|yarn|make|go|cargo)\b[^\n]*)/.exec(value);
  return match?.[1].replace(/[.)\]]+$/g, "").trim();
}

type ParsedFixCommand = { command: string; args: string[] };

function parseCommand(command: string): ParsedFixCommand | undefined {
  if (/[;&|<>$]/.test(command)) return undefined;
  const parts = command.trim().split(/\s+/);
  const allowed = ["./gradlew", "gradle", "./mvnw", "mvn", "npm", "pnpm", "yarn", "make", "go", "cargo"];
  if (!allowed.includes(parts[0])) return undefined;
  return { command: parts[0], args: parts.slice(1) };
}

async function resolveFixGradleProjectCommand(job: FixJob, repoDir: string, parsed: ParsedFixCommand, token: string): Promise<ParsedFixCommand> {
  if (parsed.command !== "./gradlew" && parsed.command !== "gradle") return parsed;
  const taskIndex = parsed.args.findIndex((arg) => /^:[^-\s]+:[^:\s]+$/.test(arg));
  if (taskIndex < 0) return parsed;
  const taskPath = parsed.args[taskIndex];
  const lastColon = taskPath.lastIndexOf(":");
  const requestedProject = taskPath.slice(0, lastColon);
  const taskName = taskPath.slice(lastColon + 1);
  update(job, { statusMessage: `Checking Gradle projects before running ${taskPath}.` });
  const projects = await discoverFixGradleProjects(job, repoDir, parsed.command, token);
  if (projects.has(requestedProject)) return parsed;
  const replacement = closestFixGradleProject(requestedProject, projects);
  if (!replacement) return parsed;
  const args = [...parsed.args];
  args[taskIndex] = `${replacement}:${taskName}`;
  update(job, { statusMessage: `Corrected Gradle project path ${requestedProject} to ${replacement}.` });
  return { command: parsed.command, args };
}

async function discoverFixGradleProjects(job: FixJob, repoDir: string, gradleCommand: string, token: string): Promise<Set<string>> {
  const projects = new Set<string>();
  try {
    const result = await runStreaming(job, gradleCommand, ["projects", "--quiet"], {
      cwd: repoDir,
      env: { GH_TOKEN: token, GH_HOST: "github.com" },
      timeoutMs: 3 * 60_000,
      redact: [token]
    });
    for (const match of result.stdout.matchAll(/Project '(:[^']+)'/g)) projects.add(match[1]);
  } catch {
    // Keep the original command if Gradle cannot report the resolved project model.
    // Raw settings.gradle includes can be renamed by build logic, so they are not
    // reliable enough for reviewer-facing verification commands.
  }
  return projects;
}

function closestFixGradleProject(requestedProject: string, projects: Set<string>): string | undefined {
  const requestedLeaf = requestedProject.split(":").filter(Boolean).at(-1) ?? requestedProject;
  const requestedNorm = normalizeFixGradleProjectName(requestedLeaf);
  const candidates = [...projects];
  return (
    candidates.find((project) => project.endsWith(`:${requestedLeaf}`)) ??
    candidates.find((project) => normalizeFixGradleProjectName(project.split(":").filter(Boolean).at(-1) ?? project) === requestedNorm) ??
    candidates.find((project) => normalizeFixGradleProjectName(project).endsWith(requestedNorm))
  );
}

function normalizeFixGradleProjectName(value: string): string {
  return value
    .replace(/^:+/, "")
    .toLowerCase()
    .replace(/^micronaut[-_]/, "")
    .replace(/[^a-z0-9]/g, "");
}

async function requireToken(): Promise<string> {
  const token = await readGithubToken();
  if (!token) throw new Error(missingGithubTokenMessage());
  return token;
}

function update(job: FixJob, patch: Partial<FixJob> & { status?: JobStatus }): void {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  fixJobs.set(job.id, job);
  void writeFixJob(job);
}

function runStreaming(
  job: FixJob,
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number; redact?: string[] } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const isGithubCommand = command.split(/[\\/]/).pop() === "gh";
    if (isGithubCommand) assertGithubRateLimitAvailable();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"]
    });
    activeProcesses.set(job.id, child);
    let jobStdout = `${job.stdout}${job.stdout ? "\n" : ""}$ ${[command, ...args].join(" ")}\n`;
    let jobStderr = job.stderr;
    let commandStdout = "";
    let commandStderr = "";
    let settled = false;
    const stdoutPipe = child.stdout;
    const stderrPipe = child.stderr;
    update(job, { stdout: trim(jobStdout), stderr: trim(jobStderr) });
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          settled = true;
          child.kill("SIGTERM");
          reject(new CommandError(`${command} timed out after ${options.timeoutMs}ms`, { stdout: commandStdout, stderr: commandStderr, exitCode: null }));
        }, options.timeoutMs)
      : undefined;
    stdoutPipe?.setEncoding("utf8");
    stderrPipe?.setEncoding("utf8");
    stdoutPipe?.on("data", (chunk) => {
      const text = redact(String(chunk), options.redact);
      commandStdout += text;
      jobStdout += text;
      update(job, { stdout: trim(jobStdout), stderr: trim(jobStderr) });
    });
    stderrPipe?.on("data", (chunk) => {
      const text = redact(String(chunk), options.redact);
      commandStderr += text;
      jobStderr += text;
      update(job, { stdout: trim(jobStdout), stderr: trim(jobStderr) });
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      if (activeProcesses.get(job.id) === child) activeProcesses.delete(job.id);
      if (!settled) reject(error);
    });
    child.on("close", (exitCode) => {
      if (timeout) clearTimeout(timeout);
      if (activeProcesses.get(job.id) === child) activeProcesses.delete(job.id);
      if (settled) return;
      const result = { stdout: commandStdout, stderr: commandStderr, exitCode };
      update(job, { stdout: trim(jobStdout), stderr: trim(jobStderr), exitCode });
      if (cancelledJobs.has(job.id)) {
        reject(new CommandError(`${command} cancelled`, result));
        return;
      }
      if (exitCode === 0) resolve(result);
      else {
        if (isGithubCommand && noteGithubRateLimit(`${result.stderr}\n${result.stdout}`)) {
          try {
            assertGithubRateLimitAvailable();
          } catch (error) {
            reject(error);
            return;
          }
        }
        reject(new CommandError(`${command} exited with code ${exitCode}`, result));
      }
    });
    if (options.input && child.stdin) {
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE" && error.code !== "EBADF") child.emit("error", error);
      });
      child.stdin.end(options.input);
    }
  });
}

function errorResult(error: unknown): Pick<FixJob, "stdout" | "stderr" | "exitCode" | "error"> {
  if (error instanceof CommandError) {
    return { stdout: trim(error.result.stdout), stderr: trim(error.result.stderr), exitCode: error.result.exitCode, error: error.message };
  }
  return { stdout: "", stderr: "", error: error instanceof Error ? error.message : String(error) };
}

function trim(value: string): string {
  const max = 30_000;
  if (value.length <= max) return value;
  const head = value.slice(0, 8_000);
  const tail = value.slice(value.length - 20_000);
  return `${head}\n\n[Output truncated from ${value.length} characters; showing latest output below.]\n\n${tail}`;
}

function redact(value: string, secrets: string[] = []): string {
  return secrets.reduce((text, secret) => (secret ? text.split(secret).join("[redacted]") : text), value);
}
