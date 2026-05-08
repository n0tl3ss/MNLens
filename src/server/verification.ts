import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { JobStatus, PrRef, VerificationArtifact, VerificationJob } from "../shared/types.js";
import { prKey, readPrDetail, readVerificationJob, readVerificationJobs, readVerificationJobsForPr, writeVerificationJob } from "./cache.js";
import { CommandError } from "./command.js";
import { runCommand } from "./command.js";
import { codexHome, ensureCodexHome } from "./codex.js";
import { assertGithubRateLimitAvailable, noteGithubRateLimit } from "./githubRateLimit.js";
import { missingGithubTokenMessage, readGithubToken } from "./keychain.js";
import { cacheDir } from "./paths.js";
import { clearRecoveryPatch, interruptedJobPatch, parsePrKey } from "./recovery.js";

const verificationJobs = new Map<string, VerificationJob>();
const verificationQueue: Array<{ job: VerificationJob; pr: PrRef; manualItem?: string }> = [];
const activeProcesses = new Map<string, ReturnType<typeof spawn>>();
const cancelledJobs = new Set<string>();
const worktreeRoot = join(cacheDir, "worktrees");
let running = false;
let recovered = false;

export async function recoverVerificationJobs(): Promise<void> {
  if (recovered) return;
  recovered = true;
  const persisted = await readVerificationJobs();
  for (const job of persisted) {
    if (job.status !== "queued" && job.status !== "running") continue;
    const pr = parsePrKey(job.prKey);
    if (!pr) {
      updateVerificationJob(job, interruptedJobPatch(job, "Verification stopped and the PR identity could not be recovered."));
      continue;
    }
    verificationJobs.set(job.id, job);
    if (job.status === "queued") {
      if (job.command.startsWith("codex-manual-check ")) {
        updateVerificationJob(
          job,
          interruptedJobPatch(job, "Manual verification was queued before MNLens stopped. Start the manual check again from Tests To Check.", {
            phase: "completed",
            statusMessage: "Manual verification interrupted."
          } as Partial<VerificationJob>)
        );
      } else {
        verificationQueue.push({ job, pr });
        updateVerificationJob(job, { ...clearRecoveryPatch<VerificationJob>(), status: "queued", phase: "queued", statusMessage: "Recovered queued verification.", error: undefined });
      }
    } else {
      updateVerificationJob(
        job,
        interruptedJobPatch(job, "Verification was interrupted when MNLens stopped. Run this check again to continue.", {
          phase: "completed",
          statusMessage: "Verification interrupted."
        } as Partial<VerificationJob>)
      );
    }
  }
  void drainVerificationQueue();
}

export async function enqueueVerification(pr: PrRef, command: string): Promise<VerificationJob> {
  const parsed = parseVerificationCommand(command);
  if (!parsed) {
    throw new Error("Could not find a runnable local verification command in that test item.");
  }
  const job: VerificationJob = {
    id: randomUUID(),
    status: "queued",
    prKey: prKey(pr.owner, pr.repo, pr.number),
    command: parsed.display,
    phase: "queued",
    statusMessage: "Waiting to start.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stdout: "",
    stderr: ""
  };
  verificationJobs.set(job.id, job);
  verificationQueue.push({ job, pr });
  await writeVerificationJob(job);
  void drainVerificationQueue();
  return job;
}

export async function enqueueManualVerification(pr: PrRef, item: string, id: string): Promise<VerificationJob> {
  const job: VerificationJob = {
    id: randomUUID(),
    status: "queued",
    prKey: prKey(pr.owner, pr.repo, pr.number),
    command: manualVerificationCommand(id),
    phase: "queued",
    statusMessage: "Waiting for Codex manual-check assistance.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stdout: "",
    stderr: ""
  };
  verificationJobs.set(job.id, job);
  verificationQueue.push({ job, pr, manualItem: item });
  await writeVerificationJob(job);
  void drainVerificationQueue();
  return job;
}

export async function getVerificationJob(id: string): Promise<VerificationJob | undefined> {
  const job = verificationJobs.get(id) ?? (await readVerificationJob(id));
  if (!job) return undefined;
  return markStaleIfNeeded(job);
}

export async function listVerificationJobs(key: string): Promise<VerificationJob[]> {
  const persisted = await readVerificationJobsForPr(key);
  const byId = new Map<string, VerificationJob>();
  for (const job of persisted) byId.set(job.id, markStaleIfNeeded(job));
  for (const job of verificationJobs.values()) {
    if (job.prKey === key) byId.set(job.id, job);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function cancelVerificationJob(id: string): Promise<VerificationJob> {
  const job = verificationJobs.get(id) ?? (await readVerificationJob(id));
  if (!job) throw new Error("Verification job not found.");
  if (job.status !== "queued" && job.status !== "running") return job;
  cancelledJobs.add(id);
  const queuedIndex = verificationQueue.findIndex((item) => item.job.id === id);
  if (queuedIndex >= 0) verificationQueue.splice(queuedIndex, 1);
  const child = activeProcesses.get(id);
  if (child && !child.killed) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (activeProcesses.get(id) === child && !child.killed) child.kill("SIGKILL");
    }, 3000);
  }
  updateVerificationJob(job, {
    status: "failed",
    phase: "completed",
    statusMessage: queuedIndex >= 0 ? "Verification cancelled." : "Cancelling verification.",
    error: queuedIndex >= 0 ? "Cancelled by reviewer." : "Cancellation requested by reviewer."
  });
  return job;
}

export async function ensureVerificationWorktree(pr: PrRef): Promise<string> {
  const token = await requireToken();
  const repoDir = join(worktreeRoot, prKey(pr.owner, pr.repo, pr.number));
  const repoName = `${pr.owner}/${pr.repo}`;
  await mkdir(worktreeRoot, { recursive: true });
  if (!existsSync(join(repoDir, ".git"))) {
    await rm(repoDir, { recursive: true, force: true });
    await runCommand("gh", ["repo", "clone", repoName, repoDir, "--", "--depth", "1"], {
      env: { GH_TOKEN: token, GH_HOST: "github.com" },
      timeoutMs: 10 * 60_000,
      redact: [token]
    });
  }
  await runCommand("gh", ["pr", "checkout", String(pr.number), "--detach"], {
    cwd: repoDir,
    env: { GH_TOKEN: token, GH_HOST: "github.com" },
    timeoutMs: 5 * 60_000,
    redact: [token]
  });
  return repoDir;
}

function markStaleIfNeeded(job: VerificationJob): VerificationJob {
  if (!verificationJobs.has(job.id) && (job.status === "queued" || job.status === "running")) {
    updateVerificationJob(
      job,
      interruptedJobPatch(job, "Verification worker stopped before this command completed. Run the check again to continue.", {
        phase: "completed",
        statusMessage: "Verification interrupted."
      } as Partial<VerificationJob>)
    );
  }
  return job;
}

async function drainVerificationQueue(): Promise<void> {
  if (running) return;
  running = true;
  while (verificationQueue.length > 0) {
    const item = verificationQueue.shift();
    if (!item) continue;
    if (cancelledJobs.has(item.job.id)) {
      updateVerificationJob(item.job, {
        status: "failed",
        phase: "completed",
        statusMessage: "Verification cancelled.",
        error: "Cancelled by reviewer."
      });
      continue;
    }
    const started = Date.now();
    updateVerificationJob(item.job, { status: "running", startedAt: new Date(started).toISOString() });
    try {
      const token = await requireToken();
      updateVerificationJob(item.job, { phase: "preparing", statusMessage: "Preparing temporary PR checkout." });
      const repoDir = await preparePrWorktree(item.pr, token, item.job);
      updateVerificationJob(item.job, { repoDir });
      let result: { stdout: string; stderr: string; exitCode: number | null };
      if (item.manualItem) {
        if (isDocRenderVerification(item.manualItem)) {
          result = await runDocRenderVerification(item.job, item.pr, repoDir, item.manualItem, token);
        } else {
          await ensureCodexHome();
          updateVerificationJob(item.job, { phase: "running", statusMessage: "Codex is investigating the manual check." });
          result = await runStreamingCommand(
            item.job,
            "codex",
            ["--ask-for-approval", "never", "exec", "--skip-git-repo-check", "--sandbox", "read-only", "-"],
            {
              cwd: repoDir,
              input: manualCheckPrompt(item.manualItem),
              env: { CODEX_HOME: codexHome, GH_TOKEN: token, GH_HOST: "github.com" },
              timeoutMs: 15 * 60_000,
              redact: [token]
            }
          );
        }
      } else {
        const parsed = parseVerificationCommand(item.job.command);
        if (!parsed) throw new Error("Unsupported command.");
        const resolved = await resolveGradleProjectCommand(item.job, repoDir, parsed, token);
        updateVerificationJob(item.job, { phase: "running", statusMessage: `Running ${resolved.display}` });
        result = await runStreamingCommand(item.job, resolved.command, resolved.args, {
          cwd: repoDir,
          env: { GH_TOKEN: token, GH_HOST: "github.com" },
          timeoutMs: 20 * 60_000,
          redact: [token]
        });
      }
      updateVerificationJob(item.job, {
        status: "done",
        phase: "completed",
        statusMessage: "Verification passed.",
        stdout: trimLog(result.stdout),
        stderr: trimLog(result.stderr),
        exitCode: result.exitCode,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started
      });
    } catch (error) {
      if (cancelledJobs.has(item.job.id)) {
        updateVerificationJob(item.job, {
          status: "failed",
          phase: "completed",
          statusMessage: "Verification cancelled.",
          ...verificationError(error),
          error: "Cancelled by reviewer.",
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - started
        });
        continue;
      }
      updateVerificationJob(item.job, {
        status: "failed",
        phase: "completed",
        statusMessage: "Verification failed.",
        ...verificationError(error),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started
      });
    }
  }
  running = false;
}

export function manualVerificationCommand(id: string): string {
  return `codex-manual-check ${id}`;
}

function manualCheckPrompt(item: string): string {
  return `You are helping a human reviewer with a manual PR verification item.

Manual check:
${item}

Use the checked-out PR code in this repository. Do not modify files.

Try to answer:
- Can this be verified by static inspection?
- Is there an existing test that covers it?
- What exact command should the human run if a command is needed?
- If this should be automated, what unit/integration/TCK test should be added instead of leaving it manual?
- What evidence supports pass/fail?
- What remains genuinely manual?

Return a concise reviewer report with verdict: likely pass, likely fail, inconclusive, or needs human runtime validation.`;
}

function isDocRenderVerification(item: string): boolean {
  return /\b(doc|docs|documentation|asciidoc|adoc|guide|render|screenshot|visual)\b/i.test(item);
}

async function runDocRenderVerification(job: VerificationJob, pr: PrRef, repoDir: string, item: string, token: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  updateVerificationJob(job, { phase: "running", statusMessage: "Building docs and preparing screenshot evidence." });
  const command = docBuildCommand(repoDir);
  const build = await runStreamingCommand(job, command.command, command.args, {
    cwd: repoDir,
    env: { GH_TOKEN: token, GH_HOST: "github.com" },
    timeoutMs: 20 * 60_000,
    redact: [token]
  });
  const targets = await findDocHtmlTargets(repoDir, item, pr);
  if (targets.length === 0) {
    updateVerificationJob(job, {
      artifacts: [],
      stdout: trimLog(`${build.stdout}\n\nDocs build completed, but MNLens could not find generated HTML to screenshot.`)
    });
    return build;
  }
  const artifactsDir = join(cacheDir, "artifacts", job.id);
  await mkdir(artifactsDir, { recursive: true });
  const artifacts: VerificationArtifact[] = [];
  const screenshotLogs: string[] = [];
  const screenshotErrors: string[] = [];
  for (const target of targets) {
    const shot = await captureDocScreenshot(job, repoDir, target.url, artifactsDir);
    screenshotLogs.push(shot.stdout);
    screenshotErrors.push(shot.stderr);
    if (shot.screenshot) {
      artifacts.push({
        label: target.anchor ? `Rendered docs screenshot: #${target.anchor}` : "Rendered docs screenshot",
        path: shot.screenshot,
        kind: "screenshot",
        url: `/api/artifacts/${encodeURIComponent(job.id)}/${encodeURIComponent(basename(shot.screenshot))}`
      });
    }
    artifacts.push({
      label: target.label,
      path: target.html,
      kind: "html",
      url: `/api/artifacts?path=${encodeURIComponent(target.html)}${target.anchor ? `#${encodeURIComponent(target.anchor)}` : ""}`
    });
  }
  updateVerificationJob(job, {
    artifacts,
    statusMessage: artifacts.some((artifact) => artifact.kind === "screenshot")
      ? targets.length > 1
        ? `Docs built and ${targets.length} section screenshots captured.`
        : "Docs built and screenshot captured."
      : "Docs built; screenshot capture did not produce a file."
  });
  return {
    stdout: trimLog(`${build.stdout}\n\n${screenshotLogs.filter(Boolean).join("\n\n")}`),
    stderr: trimLog(`${build.stderr}\n\n${screenshotErrors.filter(Boolean).join("\n\n")}`),
    exitCode: build.exitCode
  };
}

async function captureDocScreenshot(
  job: VerificationJob,
  repoDir: string,
  url: string,
  artifactsDir: string
): Promise<{ stdout: string; stderr: string; screenshot?: string }> {
  try {
    const open = await runStreamingCommand(job, "agent-browser", ["open", url], {
      cwd: repoDir,
      timeoutMs: 30_000
    });
    const anchor = anchorFromUrl(url);
    const scroll = anchor
      ? await runStreamingCommand(job, "agent-browser", ["eval", "--stdin"], {
          cwd: repoDir,
          input: scrollToAnchorScript(anchor),
          timeoutMs: 10_000
        })
      : { stdout: "", stderr: "", exitCode: 0 };
    const wait = await runStreamingCommand(job, "agent-browser", ["wait", "1000"], {
      cwd: repoDir,
      timeoutMs: 5_000
    });
    const shot = await runStreamingCommand(job, "agent-browser", ["screenshot", "--screenshot-dir", artifactsDir], {
      cwd: repoDir,
      timeoutMs: 30_000
    });
    const screenshot = screenshotPathFromOutput(shot.stdout) ?? (await newestFile(artifactsDir));
    return {
      stdout: trimLog(`${open.stdout}\n\n${scroll.stdout}\n\n${wait.stdout}\n\n${shot.stdout}`),
      stderr: trimLog(`${open.stderr}\n\n${scroll.stderr}\n\n${wait.stderr}\n\n${shot.stderr}`),
      screenshot
    };
  } catch (error) {
    if (error instanceof CommandError) {
      return {
        stdout: trimLog(`${error.result.stdout}\n\nDocs HTML was generated, but screenshot capture failed. Open the rendered HTML artifact instead.`),
        stderr: trimLog(error.result.stderr),
        screenshot: await newestFile(artifactsDir)
      };
    }
    return {
      stdout: "Docs HTML was generated, but screenshot capture failed. Open the rendered HTML artifact instead.",
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
}

function anchorFromUrl(url: string): string | undefined {
  try {
    const hash = new URL(url).hash;
    return hash ? decodeURIComponent(hash.slice(1)) : undefined;
  } catch {
    return undefined;
  }
}

function scrollToAnchorScript(anchor: string): string {
  return `(() => {
  const anchor = ${JSON.stringify(anchor)};
  if (!anchor) return "no anchor";
  if (location.hash !== "#" + encodeURIComponent(anchor)) {
    location.hash = anchor;
  }
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(anchor) : anchor.replace(/["\\\\]/g, "\\\\$&");
  const target =
    document.getElementById(anchor) ||
    document.querySelector("[name=\\"" + escaped + "\\"]") ||
    document.querySelector("[id$=\\"" + escaped + "\\"]");
  if (!target) {
    return "anchor not found: " + anchor + " at " + location.href;
  }
  target.scrollIntoView({ block: "start", inline: "nearest" });
  window.scrollBy(0, -24);
  return "scrolled to " + anchor + " y=" + Math.round(window.scrollY);
})()`;
}

function docBuildCommand(repoDir: string): { command: string; args: string[] } {
  if (existsSync(join(repoDir, "gradlew"))) return { command: "./gradlew", args: ["docs"] };
  if (existsSync(join(repoDir, "mvnw"))) return { command: "./mvnw", args: ["site"] };
  if (existsSync(join(repoDir, "package.json"))) return { command: "npm", args: ["run", "docs"] };
  return { command: "gradle", args: ["docs"] };
}

type DocHtmlTarget = { html: string; url: string; label: string; anchor?: string; anchorOffset?: number };

async function findDocHtmlTargets(repoDir: string, item: string, pr: PrRef): Promise<DocHtmlTarget[]> {
  const detail = await readPrDetail(prKey(pr.owner, pr.repo, pr.number));
  const itemDoc = /([\w./-]+)\.(?:adoc|md|html?)\b/i.exec(item)?.[0];
  const changedDocs = detail?.files.map((file) => file.path).filter(isDocsSourcePath) ?? [];
  const docPaths = uniqueStrings([itemDoc, ...changedDocs].filter(Boolean) as string[]);
  const docStem = docPaths[0] ? basename(docPaths[0]).replace(/\.(adoc|md|html?)$/i, "") : undefined;
  const preferredName = docStem ? `${docStem}.html` : undefined;
  const roots = ["build", "target", "docs", "site"].map((part) => join(repoDir, part)).filter((path) => existsSync(path));
  const htmlFiles: string[] = [];
  for (const root of roots) htmlFiles.push(...(await collectFiles(root, (path) => path.endsWith(".html"))));

  const targets: DocHtmlTarget[] = [];
  const anchorCandidates = await docAnchorCandidates(repoDir, item, docPaths, detail?.diff ?? "");
  for (const anchor of anchorCandidates) {
    const matched = await firstHtmlContainingAnchor(rankDocHtmlFiles(htmlFiles.filter((path) => /index\.html$/i.test(path))), anchor);
    if (matched && !hasNearbyDocTarget(targets, matched.html, matched.offset)) {
      targets.push({
        html: matched.html,
        url: `${pathToFileURL(matched.html).href}#${encodeURIComponent(anchor)}`,
        label: `Rendered docs guide: ${basename(matched.html)}#${anchor}`,
        anchor,
        anchorOffset: matched.offset
      });
    }
  }
  if (targets.length > 0) return targets.slice(0, 4);

  if (preferredName) {
    const exact = rankDocHtmlFiles(htmlFiles.filter((path) => basename(path).toLowerCase() === preferredName.toLowerCase()))[0];
    if (exact) {
      return [{
        html: exact,
        url: pathToFileURL(exact).href,
        label: `Rendered docs HTML: ${basename(exact)}`
      }];
    }
  }
  const fallback = rankDocHtmlFiles(htmlFiles.filter((path) => /index\.html$/i.test(path)))[0] ?? rankDocHtmlFiles(htmlFiles)[0];
  return fallback
    ? [{
        html: fallback,
        url: pathToFileURL(fallback).href,
        label: `Rendered docs HTML: ${basename(fallback)}`
      }]
    : [];
}

function isDocsSourcePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return normalized.startsWith("src/main/docs/") || normalized.startsWith("docs/") || normalized.endsWith(".adoc") || normalized.endsWith(".md");
}

async function firstHtmlContainingAnchor(files: string[], anchor: string): Promise<{ html: string; offset: number } | undefined> {
  for (const file of files) {
    const html = await readFile(file, "utf8").catch(() => "");
    const offset = htmlAnchorOffset(html, anchor);
    if (offset >= 0) return { html: file, offset };
  }
  return undefined;
}

export function htmlAnchorOffset(html: string, anchor: string): number {
  const escaped = escapeRegExp(anchor);
  const pattern = new RegExp(`<[^>]+(?:id|name)=["']${escaped}["'][^>]*>`, "i");
  const match = pattern.exec(html);
  return match?.index ?? -1;
}

function hasNearbyDocTarget(targets: DocHtmlTarget[], html: string, offset: number): boolean {
  const nearbyThreshold = 5000;
  return targets.some((target) => target.html === html && typeof target.anchorOffset === "number" && Math.abs(target.anchorOffset - offset) <= nearbyThreshold);
}

async function docAnchorCandidates(repoDir: string, item: string, docPaths: string[], diff: string): Promise<string[]> {
  const anchors: string[] = [];
  const explicitAnchor = /#([A-Za-z][\w.-]*)/.exec(item)?.[1];
  if (explicitAnchor) anchors.push(explicitAnchor);
  for (const title of changedDocTitlesFromDiff(diff, docPaths)) anchors.push(...anchorVariants(title));
  for (const docPath of docPaths) {
    const stem = basename(docPath).replace(/\.(adoc|md|html?)$/i, "");
    anchors.push(stem, ...anchorVariants(stem));
    const content = await readFile(join(repoDir, docPath), "utf8").catch(() => "");
    for (const anchor of explicitAnchorsFromAsciiDoc(content)) anchors.push(anchor);
    for (const title of docTitles(content).slice(0, 6)) anchors.push(...anchorVariants(title));
  }
  return uniqueStrings(anchors.filter(Boolean)).slice(0, 24);
}

function changedDocTitlesFromDiff(diff: string, docPaths: string[]): string[] {
  const wanted = new Set(docPaths.map((path) => path.replace(/\\/g, "/")));
  const titles: string[] = [];
  let currentPath = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      currentPath = match?.[2] ?? "";
      continue;
    }
    if (!wanted.has(currentPath) || !line.startsWith("+") || line.startsWith("+++")) continue;
    const title = docTitleFromLine(line.slice(1));
    if (title) titles.push(title);
    titles.push(...explicitAnchorsFromAsciiDoc(line.slice(1)));
  }
  return titles;
}

function docTitles(content: string): string[] {
  return content.split(/\r?\n/).map(docTitleFromLine).filter(Boolean) as string[];
}

function docTitleFromLine(line: string): string | undefined {
  const adoc = /^(={1,6})\s+(.+?)\s*$/.exec(line.trim());
  if (adoc) return cleanDocTitle(adoc[2]);
  const md = /^(#{1,6})\s+(.+?)\s*$/.exec(line.trim());
  return md ? cleanDocTitle(md[2]) : undefined;
}

export function explicitAnchorsFromAsciiDoc(content: string): string[] {
  const anchors: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    const block = /^\[\[([A-Za-z][\w.-]*)\]\]$/.exec(trimmed);
    const shorthand = /^\[#([A-Za-z][\w.-]*)\]$/.exec(trimmed);
    const id = /^\[id=["']?([A-Za-z][\w.-]*)["']?\]$/.exec(trimmed);
    const anchor = block?.[1] ?? shorthand?.[1] ?? id?.[1];
    if (anchor) anchors.push(anchor);
  }
  return anchors;
}

function anchorVariants(value: string): string[] {
  const cleaned = cleanDocTitle(value);
  if (!cleaned) return [];
  const words = cleaned.match(/[A-Za-z0-9]+/g) ?? [];
  if (words.length === 0) return [];
  const camel = words.map((word, index) => {
    const lower = word.charAt(0).toLowerCase() + word.slice(1);
    return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join("");
  const normalizedCamel = words.map((word, index) => {
    const lower = word.toLowerCase();
    return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join("");
  const snake = `_${words.map((word) => word.toLowerCase()).join("_")}`;
  const kebab = words.map((word) => word.toLowerCase()).join("-");
  return uniqueStrings([cleaned, camel, normalizedCamel, snake, kebab]);
}

function cleanDocTitle(value: string): string {
  return value
    .replace(/\[\[.+?\]\]/g, "")
    .replace(/\{.+?\}/g, "")
    .replace(/https?:\/\/\S+\[(.+?)\]/g, "$1")
    .replace(/[`*_#]/g, "")
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rankDocHtmlFiles(files: string[]): string[] {
  return [...files].sort((left, right) => docHtmlScore(right) - docHtmlScore(left) || left.localeCompare(right));
}

function docHtmlScore(path: string): number {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  let score = 0;
  if (normalized.includes("/build/docs/")) score += 100;
  if (normalized.includes("/build/working/04-assembled-docs/")) score += 80;
  if (normalized.includes("/build/working/02-docs-raw/")) score += 60;
  if (normalized.includes("/guide/")) score += 20;
  if (normalized.includes("/javadoc/")) score -= 50;
  if (normalized.includes("/style/")) score -= 40;
  return score;
}

async function collectFiles(dir: string, predicate: (path: string) => boolean, depth = 0): Promise<string[]> {
  if (depth > 7) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const results: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...(await collectFiles(path, predicate, depth + 1)));
    else if (entry.isFile() && predicate(path)) results.push(path);
  }
  return results;
}

function screenshotPathFromOutput(output: string): string | undefined {
  return /Screenshot saved to (.+?\.png)/.exec(output)?.[1];
}

async function newestFile(dir: string): Promise<string | undefined> {
  const files = await collectFiles(dir, () => true, 1);
  return files.sort().at(-1);
}

async function preparePrWorktree(pr: PrRef, token: string, job: VerificationJob): Promise<string> {
  const repoDir = join(worktreeRoot, prKey(pr.owner, pr.repo, pr.number));
  const repoName = `${pr.owner}/${pr.repo}`;
  await mkdir(worktreeRoot, { recursive: true });
  if (!existsSync(join(repoDir, ".git"))) {
    updateVerificationJob(job, { phase: "cloning", statusMessage: `Cloning ${repoName} into a temporary review checkout.` });
    await rm(repoDir, { recursive: true, force: true });
    await runStreamingCommand(job, "gh", ["repo", "clone", repoName, repoDir, "--", "--depth", "1"], {
      env: { GH_TOKEN: token, GH_HOST: "github.com" },
      timeoutMs: 10 * 60_000,
      redact: [token]
    });
  }
  updateVerificationJob(job, { phase: "checking-out", statusMessage: `Checking out PR #${pr.number}.` });
  await runStreamingCommand(job, "gh", ["pr", "checkout", String(pr.number), "--detach"], {
    cwd: repoDir,
    env: { GH_TOKEN: token, GH_HOST: "github.com" },
    timeoutMs: 5 * 60_000,
    redact: [token]
  });
  return repoDir;
}

type ParsedVerificationCommand = { command: string; args: string[]; display: string };

export function parseVerificationCommand(command: string): ParsedVerificationCommand | undefined {
  const trimmed = normalizeVerificationCommand(command);
  if (!trimmed || /[;&|<>$]/.test(trimmed)) return undefined;
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (const char of trimmed) {
    if ((char === "'" || char === `"`) && !quote) {
      quote = char;
      continue;
    }
    if (quote === char) {
      quote = undefined;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) return undefined;
  if (current) parts.push(current);
  if (parts.length === 0) return undefined;
  const executable = parts[0];
  if (!isAllowedExecutable(executable)) return undefined;
  return { command: executable, args: parts.slice(1), display: parts.join(" ") };
}

async function resolveGradleProjectCommand(
  job: VerificationJob,
  repoDir: string,
  parsed: ParsedVerificationCommand,
  token: string
): Promise<ParsedVerificationCommand> {
  if (!isGradleCommand(parsed.command)) return parsed;
  const taskIndex = parsed.args.findIndex((arg) => /^:[^-\s]+:[^:\s]+$/.test(arg));
  if (taskIndex < 0) return parsed;
  const taskPath = parsed.args[taskIndex];
  const lastColon = taskPath.lastIndexOf(":");
  const requestedProject = taskPath.slice(0, lastColon);
  const taskName = taskPath.slice(lastColon + 1);
  updateVerificationJob(job, {
    phase: "preparing",
    statusMessage: `Checking Gradle projects before running ${taskPath}.`
  });
  const projects = await discoverGradleProjects(job, repoDir, parsed.command, token);
  if (projects.has(requestedProject)) return parsed;
  const replacement = closestGradleProject(requestedProject, projects);
  if (!replacement) return parsed;
  const args = [...parsed.args];
  args[taskIndex] = `${replacement}:${taskName}`;
  return {
    command: parsed.command,
    args,
    display: [parsed.command, ...args].join(" ")
  };
}

async function discoverGradleProjects(job: VerificationJob, repoDir: string, gradleCommand: string, token: string): Promise<Set<string>> {
  const projects = new Set<string>();
  try {
    const result = await runStreamingCommand(job, gradleCommand, ["projects", "--quiet"], {
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

export function closestGradleProject(requestedProject: string, projects: Set<string>): string | undefined {
  const requestedLeaf = requestedProject.split(":").filter(Boolean).at(-1) ?? requestedProject;
  const requestedNorm = normalizeGradleProjectName(requestedLeaf);
  const candidates = [...projects];
  return (
    candidates.find((project) => project.endsWith(`:${requestedLeaf}`)) ??
    candidates.find((project) => normalizeGradleProjectName(project.split(":").filter(Boolean).at(-1) ?? project) === requestedNorm) ??
    candidates.find((project) => normalizeGradleProjectName(project).endsWith(requestedNorm))
  );
}

function normalizeGradleProjectName(value: string): string {
  return value
    .replace(/^:+/, "")
    .toLowerCase()
    .replace(/^micronaut[-_]/, "")
    .replace(/[^a-z0-9]/g, "");
}

function isGradleCommand(command: string): boolean {
  return command === "./gradlew" || command === "gradle";
}

export function normalizeVerificationCommand(command: string): string {
  let value = command.trim();
  const fenced = /```(?:\w+)?\s*([\s\S]*?)\s*```/.exec(value);
  if (fenced) value = fenced[1].trim();
  const inline = /`([^`]+)`/.exec(value);
  if (inline) value = inline[1].trim();
  if (/^(?:bash|sh|zsh|fish|cmd|powershell|pwsh)\b/i.test(value)) return value;

  const commandMatch = /((?:\.\/)?(?:gradlew|mvnw)\b[^\n]*|(?:gradle|mvn|npm|pnpm|yarn|make|go|cargo)\b[^\n]*)/.exec(value);
  value = (commandMatch?.[1] ?? value).trim();
  return value.replace(/[.)\]]+$/g, "").trim();
}

export function isAllowedExecutable(command: string): boolean {
  return [
    "./gradlew",
    "gradle",
    "./mvnw",
    "mvn",
    "npm",
    "pnpm",
    "yarn",
    "make",
    "go",
    "cargo"
  ].includes(command);
}

async function requireToken(): Promise<string> {
  const token = await readGithubToken();
  if (!token) throw new Error(missingGithubTokenMessage());
  return token;
}

function updateVerificationJob(job: VerificationJob, patch: Partial<VerificationJob> & { status?: JobStatus }): void {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  verificationJobs.set(job.id, job);
  void writeVerificationJob(job);
}

function runStreamingCommand(
  job: VerificationJob,
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    timeoutMs?: number;
    redact?: string[];
  } = {}
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
    let stdout = `${job.stdout}${job.stdout ? "\n" : ""}$ ${[command, ...args].join(" ")}\n`;
    let stderr = job.stderr;
    let settled = false;
    const stdoutPipe = child.stdout;
    const stderrPipe = child.stderr;
    updateVerificationJob(job, { stdout: trimLog(stdout), stderr: trimLog(stderr) });

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          settled = true;
          child.kill("SIGTERM");
          const result = { stdout: trimLog(stdout), stderr: trimLog(stderr), exitCode: null };
          updateVerificationJob(job, {
            stdout: result.stdout,
            stderr: result.stderr,
            error: `${command} timed out after ${options.timeoutMs}ms`
          });
          reject(new CommandError(`${command} timed out after ${options.timeoutMs}ms`, result));
        }, options.timeoutMs)
      : undefined;

    stdoutPipe?.setEncoding("utf8");
    stderrPipe?.setEncoding("utf8");
    stdoutPipe?.on("data", (chunk) => {
      stdout += redact(String(chunk), options.redact);
      updateVerificationJob(job, { stdout: trimLog(stdout), stderr: trimLog(stderr) });
    });
    stderrPipe?.on("data", (chunk) => {
      stderr += redact(String(chunk), options.redact);
      updateVerificationJob(job, { stdout: trimLog(stdout), stderr: trimLog(stderr) });
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      activeProcesses.delete(job.id);
      if (!settled) reject(error);
    });
    child.on("close", (exitCode) => {
      if (timeout) clearTimeout(timeout);
      activeProcesses.delete(job.id);
      if (settled) return;
      const result = { stdout: trimLog(stdout), stderr: trimLog(stderr), exitCode };
      updateVerificationJob(job, result);
      if (cancelledJobs.has(job.id)) {
        reject(new CommandError("Verification cancelled by reviewer.", result));
        return;
      }
      if (exitCode === 0) {
        resolve(result);
      } else {
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

function verificationError(error: unknown): Pick<VerificationJob, "stdout" | "stderr" | "exitCode" | "error"> {
  if (error instanceof CommandError) {
    return {
      stdout: trimLog(error.result.stdout),
      stderr: trimLog(error.result.stderr),
      exitCode: error.result.exitCode,
      error: error.message
    };
  }
  return {
    stdout: "",
    stderr: "",
    error: error instanceof Error ? error.message : String(error)
  };
}

function trimLog(value: string): string {
  const max = 24_000;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[Output truncated from ${value.length} characters.]`;
}

function redact(value: string, secrets: string[] = []): string {
  return secrets.reduce((text, secret) => {
    if (!secret) return text;
    return text.split(secret).join("[redacted]");
  }, value);
}
