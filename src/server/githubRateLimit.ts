import type { GithubRateLimitInfo, GithubRateLimitResource } from "../shared/types.js";

const defaultCooldownMs = 30 * 60_000;

/**
 * GitHub meters REST ("core"), GraphQL and search separately. MNLens's queue,
 * PR details and stack detection run on GraphQL through `gh`, so the REST
 * budget can sit at 5000/5000 while GraphQL is being drained. The status below
 * therefore tracks every resource and reports the busiest one as the headline.
 */
const displayedResources = ["core", "graphql", "search", "code_search"] as const;
/** Hourly budgets drive the headline; the per-minute search budgets only take over when fully drained. */
const headlineResources = ["core", "graphql"] as const;

let rateLimitedUntil = 0;
let rateLimitMessage = "";
let latestResources: Record<string, GithubRateLimitResource> = {};

export class GithubRateLimitError extends Error {
  readonly status = 429;

  constructor(message: string) {
    super(message);
  }
}

export function assertGithubRateLimitAvailable(): void {
  const now = Date.now();
  if (rateLimitedUntil <= now) return;
  throw new GithubRateLimitError(rateLimitStatusMessage());
}

export function noteGithubRateLimit(output: string): boolean {
  if (!isGithubRateLimitOutput(output)) return false;
  rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + cooldownFor(output));
  rateLimitMessage = compactGithubError(output);
  return true;
}

/** Record the `x-ratelimit-*` headers of one REST response (`gh api -i ...`). */
export function noteGithubRateLimitHeaders(headers: string): void {
  const limit = parseRateHeader(headers, "x-ratelimit-limit");
  const remaining = parseRateHeader(headers, "x-ratelimit-remaining");
  const used = parseRateHeader(headers, "x-ratelimit-used");
  const reset = parseRateHeader(headers, "x-ratelimit-reset");
  const resource = parseStringHeader(headers, "x-ratelimit-resource") ?? "core";
  if (limit === undefined && remaining === undefined && used === undefined && reset === undefined) return;
  latestResources = {
    ...latestResources,
    [resource]: { limit, remaining, used, resetAt: epochToIso(reset) }
  };
  applyPrimaryCooldownIfExhausted();
}

/** Record the body of `gh api rate_limit`, which lists every metered resource. */
export function noteGithubRateLimitBody(body: unknown): void {
  const resources = body && typeof body === "object" && "resources" in body ? (body as { resources?: Record<string, unknown> }).resources : undefined;
  if (!resources || typeof resources !== "object") return;
  const next: Record<string, GithubRateLimitResource> = {};
  for (const [name, value] of Object.entries(resources)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    next[name] = {
      limit: numberValue(entry.limit),
      remaining: numberValue(entry.remaining),
      used: numberValue(entry.used),
      resetAt: epochToIso(numberValue(entry.reset))
    };
  }
  if (Object.keys(next).length === 0) return;
  latestResources = next;
  applyPrimaryCooldownIfExhausted();
}

export function resetGithubRateLimitForTests(): void {
  rateLimitedUntil = 0;
  rateLimitMessage = "";
  latestResources = {};
}

/**
 * Picks the resource the reviewer should watch: the one with the smallest
 * share of its budget left. Ties (e.g. two untouched budgets) go to the one
 * that has been used most, then to REST "core".
 */
export function pickBusiestRateLimitResource(resources: Record<string, GithubRateLimitResource>): string | undefined {
  const measurable = Object.entries(resources).filter(([name, value]) => (displayedResources as readonly string[]).includes(name) && typeof value.limit === "number" && typeof value.remaining === "number" && value.limit > 0);
  const drainedSearch = measurable.filter(([name, value]) => !(headlineResources as readonly string[]).includes(name) && value.remaining === 0);
  const candidates = drainedSearch.length > 0 ? drainedSearch : measurable.filter(([name]) => (headlineResources as readonly string[]).includes(name));
  if (candidates.length === 0) return measurable[0]?.[0] ?? Object.keys(resources)[0];
  candidates.sort(([nameA, a], [nameB, b]) => {
    const ratio = a.remaining! / a.limit! - b.remaining! / b.limit!;
    if (ratio !== 0) return ratio;
    const used = (b.used ?? 0) - (a.used ?? 0);
    if (used !== 0) return used;
    return displayedResources.indexOf(nameA as (typeof displayedResources)[number]) - displayedResources.indexOf(nameB as (typeof displayedResources)[number]);
  });
  return candidates[0][0];
}

export function githubRateLimitStatus(): GithubRateLimitInfo {
  const now = Date.now();
  const resource = pickBusiestRateLimitResource(latestResources);
  const primary = resource ? latestResources[resource] : undefined;
  const base: GithubRateLimitInfo = {
    limited: false,
    ...(primary ?? {}),
    resource,
    resources: Object.keys(latestResources).length > 0 ? { ...latestResources } : undefined
  };
  if (rateLimitedUntil <= now) return base;
  return {
    ...base,
    limited: true,
    until: new Date(rateLimitedUntil).toISOString(),
    message: rateLimitMessage || "GitHub API rate limit reached.",
    retryAfterSeconds: Math.max(1, Math.ceil((rateLimitedUntil - now) / 1000))
  };
}

function isGithubRateLimitOutput(output: string): boolean {
  return /api rate limit exceeded|secondary rate limit|abuse detection mechanism/i.test(output);
}

function cooldownFor(output: string): number {
  if (/secondary rate limit|abuse detection mechanism/i.test(output)) return 5 * 60_000;
  return defaultCooldownMs;
}

function rateLimitStatusMessage(): string {
  const status = githubRateLimitStatus();
  return `GitHub API rate limit reached. MNLens paused GitHub-backed refreshes and queued GitHub work until ${status.until ?? "the cooldown expires"}.`;
}

function compactGithubError(output: string): string {
  const line = output
    .split("\n")
    .map((item) => item.trim())
    .find((item) => /rate limit|abuse detection/i.test(item));
  return line || "GitHub API rate limit reached.";
}

function parseRateHeader(headers: string, name: string): number | undefined {
  const value = parseStringHeader(headers, name);
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseStringHeader(headers: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}:\\s*(.+)$`, "im").exec(headers);
  return match?.[1]?.trim();
}

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function epochToIso(seconds: number | undefined): string | undefined {
  return seconds === undefined ? undefined : new Date(seconds * 1000).toISOString();
}

/** A fully drained REST or GraphQL budget pauses GitHub work until that budget resets. */
function applyPrimaryCooldownIfExhausted(): void {
  for (const name of ["core", "graphql"]) {
    const resource = latestResources[name];
    if (!resource || resource.remaining !== 0 || !resource.resetAt) continue;
    const resetAtMs = new Date(resource.resetAt).getTime();
    if (!Number.isFinite(resetAtMs) || resetAtMs <= Date.now()) continue;
    rateLimitedUntil = Math.max(rateLimitedUntil, resetAtMs);
    rateLimitMessage = `GitHub ${name === "core" ? "REST" : "GraphQL"} API rate limit exhausted.`;
  }
}
