const defaultCooldownMs = 30 * 60_000;

let rateLimitedUntil = 0;
let rateLimitMessage = "";
let latestPrimaryRateLimit:
  | {
      limit?: number;
      remaining?: number;
      used?: number;
      resetAt?: string;
      resource?: string;
    }
  | undefined;

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

export function noteGithubRateLimitHeaders(headers: string): void {
  const limit = parseRateHeader(headers, "x-ratelimit-limit");
  const remaining = parseRateHeader(headers, "x-ratelimit-remaining");
  const used = parseRateHeader(headers, "x-ratelimit-used");
  const reset = parseRateHeader(headers, "x-ratelimit-reset");
  const resource = parseStringHeader(headers, "x-ratelimit-resource");
  if (limit === undefined && remaining === undefined && used === undefined && reset === undefined && !resource) return;
  latestPrimaryRateLimit = {
    limit,
    remaining,
    used,
    resetAt: reset === undefined ? undefined : new Date(reset * 1000).toISOString(),
    resource
  };
  applyPrimaryCooldownIfExhausted();
}

export function noteGithubRateLimitBody(body: unknown): void {
  const core = body && typeof body === "object" && "resources" in body ? (body as { resources?: { core?: Record<string, unknown> } }).resources?.core : undefined;
  if (!core) return;
  latestPrimaryRateLimit = {
    limit: numberValue(core.limit),
    remaining: numberValue(core.remaining),
    used: numberValue(core.used),
    resetAt: numberValue(core.reset) === undefined ? undefined : new Date(Number(core.reset) * 1000).toISOString(),
    resource: "core"
  };
  applyPrimaryCooldownIfExhausted();
}

export function resetGithubRateLimitForTests(): void {
  rateLimitedUntil = 0;
  rateLimitMessage = "";
  latestPrimaryRateLimit = undefined;
}

export function githubRateLimitStatus(): {
  limited: boolean;
  limit?: number;
  remaining?: number;
  used?: number;
  resetAt?: string;
  resource?: string;
  until?: string;
  message?: string;
  retryAfterSeconds?: number;
} {
  const now = Date.now();
  if (rateLimitedUntil <= now) {
    return { limited: false, ...latestPrimaryRateLimit };
  }
  return {
    limited: true,
    ...latestPrimaryRateLimit,
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
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function applyPrimaryCooldownIfExhausted(): void {
  if (latestPrimaryRateLimit?.remaining !== 0 || !latestPrimaryRateLimit.resetAt) return;
  const resetAtMs = new Date(latestPrimaryRateLimit.resetAt).getTime();
  if (!Number.isFinite(resetAtMs) || resetAtMs <= Date.now()) return;
  rateLimitedUntil = Math.max(rateLimitedUntil, resetAtMs);
  rateLimitMessage = "GitHub primary API rate limit exhausted.";
}
