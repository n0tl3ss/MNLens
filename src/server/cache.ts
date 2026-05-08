import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnalysisResult, CacheStats, FixJob, Job, PrDetail, RepoReviewRule, ReviewProgress, VerificationJob } from "../shared/types.js";
import { cacheDir } from "./paths.js";

const prDir = join(cacheDir, "prs");
const analysisDir = join(cacheDir, "analysis");
const jobDir = join(cacheDir, "jobs");
const progressDir = join(cacheDir, "progress");
const verificationDir = join(cacheDir, "verification");
const fixDir = join(cacheDir, "fixes");
const ruleDir = join(cacheDir, "repo-rules");

export async function ensureCache(): Promise<void> {
  await mkdir(prDir, { recursive: true });
  await mkdir(analysisDir, { recursive: true });
  await mkdir(jobDir, { recursive: true });
  await mkdir(progressDir, { recursive: true });
  await mkdir(verificationDir, { recursive: true });
  await mkdir(fixDir, { recursive: true });
  await mkdir(ruleDir, { recursive: true });
}

export function prKey(owner: string, repo: string, number: number): string {
  return `${owner}__${repo}__${number}`;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function writePrDetail(detail: PrDetail): Promise<void> {
  await ensureCache();
  await writeFile(join(prDir, `${detail.key}.json`), JSON.stringify(detail, null, 2));
}

export async function readPrDetail(key: string): Promise<PrDetail | undefined> {
  return readJson<PrDetail>(join(prDir, `${key}.json`));
}

export async function writeAnalysis(result: AnalysisResult): Promise<void> {
  await ensureCache();
  await writeFile(join(analysisDir, `${result.prKey}.json`), JSON.stringify(result, null, 2));
}

export async function readAnalysis(key: string): Promise<AnalysisResult | undefined> {
  return readJson<AnalysisResult>(join(analysisDir, `${key}.json`));
}

export async function writeJob(job: Job): Promise<void> {
  await ensureCache();
  await writeFile(join(jobDir, `${job.id}.json`), JSON.stringify(job, null, 2));
}

export async function readJob(id: string): Promise<Job | undefined> {
  return readJson<Job>(join(jobDir, `${id}.json`));
}

export async function readJobs(): Promise<Job[]> {
  await ensureCache();
  const files = await safeReadDir(jobDir);
  const jobs = await Promise.all(files.filter((name) => name.endsWith(".json")).map((name) => readJson<Job>(join(jobDir, name))));
  return jobs.filter((job): job is Job => Boolean(job)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function writeVerificationJob(job: VerificationJob): Promise<void> {
  await ensureCache();
  await writeFile(join(verificationDir, `${job.id}.json`), JSON.stringify(job, null, 2));
}

export async function readVerificationJob(id: string): Promise<VerificationJob | undefined> {
  return readJson<VerificationJob>(join(verificationDir, `${id}.json`));
}

export async function readVerificationJobs(): Promise<VerificationJob[]> {
  await ensureCache();
  const files = await safeReadDir(verificationDir);
  const jobs = await Promise.all(
    files
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<VerificationJob>(join(verificationDir, name)))
  );
  return jobs.filter((job): job is VerificationJob => Boolean(job)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readVerificationJobsForPr(key: string): Promise<VerificationJob[]> {
  await ensureCache();
  const files = await safeReadDir(verificationDir);
  const jobs = await Promise.all(
    files
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<VerificationJob>(join(verificationDir, name)))
  );
  return jobs
    .filter((job): job is VerificationJob => Boolean(job && job.prKey === key))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function writeFixJob(job: FixJob): Promise<void> {
  await ensureCache();
  await writeFile(join(fixDir, `${job.id}.json`), JSON.stringify(job, null, 2));
}

export async function readFixJob(id: string): Promise<FixJob | undefined> {
  return readJson<FixJob>(join(fixDir, `${id}.json`));
}

export async function readFixJobsForPr(key: string): Promise<FixJob[]> {
  await ensureCache();
  const files = await safeReadDir(fixDir);
  const jobs = await Promise.all(files.filter((name) => name.endsWith(".json")).map((name) => readJson<FixJob>(join(fixDir, name))));
  return jobs
    .filter((job): job is FixJob => Boolean(job && job.prKey === key))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readFixJobs(): Promise<FixJob[]> {
  await ensureCache();
  const files = await safeReadDir(fixDir);
  const jobs = await Promise.all(files.filter((name) => name.endsWith(".json")).map((name) => readJson<FixJob>(join(fixDir, name))));
  return jobs.filter((job): job is FixJob => Boolean(job)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readProgress(key: string): Promise<ReviewProgress | undefined> {
  return readJson<ReviewProgress>(join(progressDir, `${key}.json`));
}

export async function writeProgress(progress: ReviewProgress): Promise<void> {
  await ensureCache();
  await writeFile(join(progressDir, `${progress.prKey}.json`), JSON.stringify(progress, null, 2));
}

export async function readRepoRules(repository: string): Promise<RepoReviewRule[]> {
  await ensureCache();
  return (await readJson<RepoReviewRule[]>(join(ruleDir, `${ruleKey(repository)}.json`))) ?? [];
}

export async function writeRepoRules(repository: string, rules: RepoReviewRule[]): Promise<void> {
  await ensureCache();
  await writeFile(join(ruleDir, `${ruleKey(repository)}.json`), JSON.stringify(rules, null, 2));
}

export async function clearPrCache(key: string): Promise<void> {
  await rm(join(prDir, `${key}.json`), { force: true });
  await rm(join(analysisDir, `${key}.json`), { force: true });
  await rm(join(progressDir, `${key}.json`), { force: true });
}

export async function exportCacheBundle(): Promise<{ exportedAt: string; fileName: string; path: string }> {
  await ensureCache();
  const exportedAt = new Date().toISOString();
  const fileName = `mnlens-review-bundle-${exportedAt.replace(/[:.]/g, "-")}.json`;
  const exportDir = join(cacheDir, "exports");
  await mkdir(exportDir, { recursive: true });
  const bundle = {
    exportedAt,
    cacheDir,
    prs: await readJsonDirectory(prDir),
    analysis: await readJsonDirectory(analysisDir),
    progress: await readJsonDirectory(progressDir),
    analysisJobs: await readJsonDirectory(jobDir),
    verificationJobs: await readJsonDirectory(verificationDir),
    fixJobs: await readJsonDirectory(fixDir),
    repoRules: await readJsonDirectory(ruleDir)
  };
  const path = join(exportDir, fileName);
  await writeFile(path, JSON.stringify(bundle, null, 2));
  return { exportedAt, fileName, path };
}

export async function clearAllCache(): Promise<void> {
  await rm(cacheDir, { recursive: true, force: true });
  await ensureCache();
}

export async function stats(): Promise<CacheStats> {
  await ensureCache();
  const [prs, analyses] = await Promise.all([safeReadDir(prDir), safeReadDir(analysisDir)]);
  return {
    prCount: prs.filter((name) => name.endsWith(".json")).length,
    analysisCount: analyses.filter((name) => name.endsWith(".json")).length,
    cacheDir
  };
}

async function safeReadDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function readJsonDirectory(path: string): Promise<Record<string, unknown>> {
  const files = await safeReadDir(path);
  const entries = await Promise.all(
    files
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => [name, await readJson<unknown>(join(path, name))] as const)
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined));
}

function ruleKey(repository: string): string {
  return repository.replace(/[^a-zA-Z0-9_.-]/g, "__");
}
