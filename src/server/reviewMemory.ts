import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FindingFeedback, FindingVerdict, RecordFindingFeedbackRequest, ReviewMemoryPattern, ReviewMemorySummary } from "../shared/types.js";
import { prKey as makePrKey } from "./cache.js";
import { cacheDir } from "./paths.js";

/**
 * Review memory.
 *
 * Every time the reviewer keeps or dismisses an AI finding, MNLens records
 * it per repository. Three things come out of that record:
 *   1. Calibration text injected into Deep Analyze prompts ("in this repo,
 *      reviewers dismissed N findings about X; do not raise it unless ...").
 *   2. Pattern summaries the reviewer can turn into repo rules with one click.
 *   3. A per-PR verdict map so the UI can show what was already judged.
 *
 * Patterns are keyed by a handful of salient words from the finding title, so
 * "Missing null check in parser" and "Null check missing for parser input"
 * land in the same bucket without any model call.
 */

const memoryDir = join(cacheDir, "review-memory");
const maxPerRepo = 2000;

const stopWords = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are", "be", "this", "that", "should", "could", "would", "may", "might",
  "not", "no", "missing", "my", "take", "probably", "if", "when", "it", "its", "as", "by", "at", "from", "into", "than", "then", "there", "their",
  "has", "have", "does", "do", "add", "added", "new", "pr", "change", "changes", "code", "check", "checks", "ensure", "consider", "use", "uses", "using"
]);

export async function recordFindingFeedback(request: RecordFindingFeedbackRequest, author?: string): Promise<ReviewMemorySummary> {
  const repository = `${request.owner}/${request.repo}`;
  const prKey = makePrKey(request.owner, request.repo, request.number);
  const entries = await readRepoMemory(repository);
  const key = verdictKey(request.kind, request.title);
  const remaining = entries.filter((entry) => !(entry.prKey === prKey && verdictKey(entry.kind, entry.title) === key));
  if (request.verdict) {
    remaining.push({
      id: randomUUID(),
      prKey,
      repository,
      author,
      kind: request.kind,
      title: request.title.trim(),
      observation: request.observation?.trim() || undefined,
      verdict: request.verdict,
      reason: request.reason?.trim() || undefined,
      at: new Date().toISOString()
    });
  }
  if (remaining.length > maxPerRepo) remaining.splice(0, remaining.length - maxPerRepo);
  await writeRepoMemory(repository, remaining);
  return summarizeMemory(repository, remaining, prKey);
}

export async function reviewMemorySummary(owner: string, repo: string, number?: number): Promise<ReviewMemorySummary> {
  const repository = `${owner}/${repo}`;
  const entries = await readRepoMemory(repository);
  return summarizeMemory(repository, entries, number ? makePrKey(owner, repo, number) : undefined);
}

export function summarizeMemory(repository: string, entries: FindingFeedback[], prKey?: string): ReviewMemorySummary {
  const buckets = new Map<string, { label: string; kept: number; dismissed: number; examples: Set<string> }>();
  for (const entry of entries) {
    const key = patternKey(entry.title);
    if (!key) continue;
    const bucket = buckets.get(key) ?? { label: key.split(" ").join(" · "), kept: 0, dismissed: 0, examples: new Set<string>() };
    if (entry.verdict === "kept") bucket.kept += 1;
    else bucket.dismissed += 1;
    if (bucket.examples.size < 3) bucket.examples.add(entry.title);
    buckets.set(key, bucket);
  }
  const patterns: ReviewMemoryPattern[] = [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      kept: bucket.kept,
      dismissed: bucket.dismissed,
      examples: [...bucket.examples],
      suggestedRule: suggestRule(bucket)
    }))
    .filter((pattern) => pattern.kept + pattern.dismissed >= 2)
    .sort((a, b) => b.kept + b.dismissed - (a.kept + a.dismissed))
    .slice(0, 25);
  const prVerdicts: Record<string, FindingVerdict> = {};
  if (prKey) {
    for (const entry of entries) if (entry.prKey === prKey) prVerdicts[verdictKey(entry.kind, entry.title)] = entry.verdict;
  }
  return {
    repository,
    total: entries.length,
    kept: entries.filter((entry) => entry.verdict === "kept").length,
    dismissed: entries.filter((entry) => entry.verdict === "dismissed").length,
    patterns,
    prVerdicts
  };
}

/** Compact calibration block for analysis prompts; empty string when there is nothing to learn from yet. */
export async function calibrationPromptBlock(repository: string): Promise<string> {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) return "";
  const summary = await reviewMemorySummary(owner, repo);
  if (summary.total < 3) return "";
  const dismissed = summary.patterns.filter((pattern) => pattern.dismissed >= 2 && pattern.dismissed > pattern.kept).slice(0, 8);
  const kept = summary.patterns.filter((pattern) => pattern.kept >= 2 && pattern.kept >= pattern.dismissed).slice(0, 8);
  if (dismissed.length === 0 && kept.length === 0) return "";
  const lines = [`Calibration from ${summary.total} past reviewer verdicts in ${repository}:`];
  if (dismissed.length > 0) {
    lines.push("- Reviewers DISMISSED findings like these; raise them only with concrete, PR-specific evidence, otherwise leave them out:");
    for (const pattern of dismissed) lines.push(`  - ${pattern.examples[0]} (dismissed ${pattern.dismissed}x, kept ${pattern.kept}x)`);
  }
  if (kept.length > 0) {
    lines.push("- Reviewers KEPT findings like these; look for them deliberately:");
    for (const pattern of kept) lines.push(`  - ${pattern.examples[0]} (kept ${pattern.kept}x)`);
  }
  return lines.join("\n");
}

export function verdictKey(kind: string, title: string): string {
  return `${kind}:${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

export function patternKey(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[`'"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 2 && !stopWords.has(word));
  return [...new Set(words)].sort().slice(0, 4).join(" ");
}

function suggestRule(bucket: { kept: number; dismissed: number; examples: Set<string> }): string | undefined {
  const example = [...bucket.examples][0];
  if (!example) return undefined;
  const total = bucket.kept + bucket.dismissed;
  if (total < 2) return undefined;
  if (bucket.dismissed >= 2 && bucket.dismissed / total >= 0.75) {
    return `Do not raise findings like "${example}" in this repository unless the PR introduces a concrete, cited instance; reviewers have dismissed this ${bucket.dismissed} times.`;
  }
  if (bucket.kept >= 3 && bucket.kept / total >= 0.75) {
    return `Always check for "${example}" in this repository; reviewers consistently act on this finding.`;
  }
  return undefined;
}

async function readRepoMemory(repository: string): Promise<FindingFeedback[]> {
  try {
    const parsed = JSON.parse(await readFile(join(memoryDir, `${fileKey(repository)}.json`), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as FindingFeedback[]) : [];
  } catch {
    return [];
  }
}

async function writeRepoMemory(repository: string, entries: FindingFeedback[]): Promise<void> {
  await mkdir(memoryDir, { recursive: true });
  await writeFile(join(memoryDir, `${fileKey(repository)}.json`), JSON.stringify(entries, null, 2));
}

function fileKey(repository: string): string {
  return repository.replace(/[^a-zA-Z0-9_.-]/g, "__");
}
