import type { AnalyzeRequest, Job, PrRef } from "../shared/types.js";
import { readJob, readJobs, writeJob } from "./cache.js";
import { analyzePr } from "./codex.js";
import { CommandError } from "./command.js";
import { getFastPrAnalysis, getPrDetail } from "./gh.js";
import { randomUUID } from "node:crypto";
import { interruptedJobPatch, parsePrKey } from "./recovery.js";

const jobs = new Map<string, Job>();
const queue: Array<{ job: Job; pr: PrRef; force: boolean }> = [];
const cancelledJobs = new Set<string>();
let running = false;
let recovered = false;

export async function recoverAnalysisJobs(): Promise<void> {
  if (recovered) return;
  recovered = true;
  const persisted = await readJobs();
  for (const job of persisted) {
    if (job.status !== "queued" && job.status !== "running") continue;
    const pr = parsePrKey(job.prKey);
    if (!pr) {
      updateJob(job, interruptedJobPatch(job, "Analysis worker stopped and the PR identity could not be recovered."));
      continue;
    }
    jobs.set(job.id, job);
    if (job.status === "queued") {
      updateJob(job, interruptedJobPatch(job, "Queued analysis was not started before MNLens closed. Run Analyze again when you want fresh review guidance."));
      continue;
    }
    updateJob(
      job,
      interruptedJobPatch(job, "Analysis worker stopped while this job was running. Reanalyze this PR to resume review guidance.")
    );
  }
  void drainQueue();
}

export async function enqueueAnalysis(request: AnalyzeRequest): Promise<Job[]> {
  const created = request.prs.map((pr) => {
    const job: Job = {
      id: randomUUID(),
      status: "queued",
      prKey: `${pr.owner}__${pr.repo}__${pr.number}`,
      mode: request.mode ?? "deep",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusMessage: request.mode === "fast" ? "Queued for fast score analysis." : "Queued for Codex review analysis.",
      stdout: "",
      stderr: ""
    };
    jobs.set(job.id, job);
    queue.push({ job, pr, force: Boolean(request.force) });
    return job;
  });
  await Promise.all(created.map((job) => writeJob(job)));
  void drainQueue();
  return created;
}

export async function getJob(id: string): Promise<Job | undefined> {
  const job = jobs.get(id) ?? (await readJob(id));
  if (!job) return undefined;
  if (isStaleActiveJob(job)) {
    updateJob(job, interruptedJobPatch(job, "Analysis worker stopped before this job completed. Reanalyze this PR to resume review guidance."));
  }
  return job;
}

export function jobStatusForPr(prKey: string): Job | undefined {
  return [...jobs.values()]
    .filter((job) => job.prKey === prKey)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export async function cancelAnalysisJob(id: string): Promise<Job> {
  const job = jobs.get(id) ?? (await readJob(id));
  if (!job) throw new Error("Analysis job not found.");
  if (job.status !== "queued" && job.status !== "running") return job;
  cancelledJobs.add(id);
  const queuedIndex = queue.findIndex((item) => item.job.id === id);
  if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
  updateJob(job, {
    status: "failed",
    error: queuedIndex >= 0 ? "Analysis job cancelled by reviewer." : "Analysis cancellation requested by reviewer."
  });
  return job;
}

async function drainQueue(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    if (cancelledJobs.has(item.job.id)) {
      updateJob(item.job, { status: "failed", error: "Analysis job cancelled by reviewer." });
      continue;
    }
    const started = Date.now();
    updateJob(item.job, {
      status: "running",
      startedAt: new Date(started).toISOString(),
      statusMessage: item.job.mode === "fast" ? "Fetching lightweight PR metadata for fast scoring." : "Fetching PR details before analysis."
    });
    try {
      if (item.job.mode === "fast") {
        const fast = await getFastPrAnalysis(item.pr.owner, item.pr.repo, item.pr.number);
        updateJob(item.job, {
          status: "done",
          fast,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
          statusMessage: "Fast score analysis completed."
        });
        continue;
      }
      const detail = await getPrDetail(item.pr.owner, item.pr.repo, item.pr.number);
      if (cancelledJobs.has(item.job.id)) {
        updateJob(item.job, { status: "failed", error: "Analysis job cancelled by reviewer." });
        continue;
      }
      const result = await analyzePr(detail, item.force, {
        onStatus: (statusMessage) => updateJob(item.job, { statusMessage }),
        onStdout: (chunk) => appendJobOutput(item.job, "stdout", chunk),
        onStderr: (chunk) => appendJobOutput(item.job, "stderr", chunk)
      });
      if (cancelledJobs.has(item.job.id)) {
        updateJob(item.job, { status: "failed", error: "Analysis job cancelled by reviewer." });
        continue;
      }
      updateJob(item.job, {
        status: "done",
        result,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        statusMessage: "Analysis completed."
      });
    } catch (error) {
      if (cancelledJobs.has(item.job.id)) {
        updateJob(item.job, { status: "failed", error: "Analysis job cancelled by reviewer." });
        continue;
      }
      updateJob(item.job, {
        status: "failed",
        error: jobErrorMessage(error),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        statusMessage: "Analysis failed."
      });
    }
  }
  running = false;
}

function jobErrorMessage(error: unknown): string {
  if (error instanceof CommandError) {
    return [error.message, error.result.stderr, error.result.stdout].filter(Boolean).join("\n").trim();
  }
  return error instanceof Error ? error.message : String(error);
}

function updateJob(job: Job, patch: Partial<Job>): void {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  jobs.set(job.id, job);
  void writeJob(job);
}

function appendJobOutput(job: Job, stream: "stdout" | "stderr", chunk: string): void {
  const current = job[stream] ?? "";
  updateJob(job, { [stream]: trimLog(`${current}${chunk}`) });
}

function trimLog(value: string): string {
  return value.length > 80_000 ? value.slice(-80_000) : value;
}

function isStaleActiveJob(job: Job): boolean {
  if (jobs.has(job.id)) return false;
  if (job.status !== "queued" && job.status !== "running") return false;
  return true;
}
