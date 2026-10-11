import type { CreateRepoReviewRuleRequest, RepoReviewRule, RepoRulesExport, UpdateRepoReviewRuleRequest } from "../shared/types.js";
import { readRepoRules as readLocalRules, writeRepoRules as writeLocalRules } from "./cache.js";
import { runCommand } from "./command.js";
import { githubCliEnv } from "./githubHost.js";
import { readGithubToken } from "./keychain.js";
import { readTeamJson, teamDir, writeTeamJson } from "./teamStore.js";

/**
 * Repository review rules from three places, merged in this order of authority:
 *
 *   1. `.mnlens/review-rules.json` committed in the repository (maintainers'
 *      policy; every reviewer gets it automatically, read-only here).
 *   2. The shared team folder (`<team>/<owner>__<repo>/rules.json`).
 *   3. This machine's local cache.
 *
 * Writes go to the team folder when one is configured, otherwise local.
 * A repository rule can be switched off locally; the override is stored as a
 * copy with the same id, so the toggle survives re-fetching.
 */

export const repositoryRulesPath = ".mnlens/review-rules.json";

const repoRulesTtlMs = 10 * 60_000;
const repoRulesCache = new Map<string, { fetchedAt: number; rules: RepoReviewRule[] }>();

export async function listRepoRules(repository: string, options: { skipRepository?: boolean } = {}): Promise<RepoReviewRule[]> {
  const stored = await readStoredRules(repository);
  const committed = options.skipRepository ? [] : await repositoryRules(repository).catch(() => []);
  const byId = new Map<string, RepoReviewRule>();
  for (const rule of committed) {
    const override = stored.find((item) => item.id === rule.id);
    byId.set(rule.id, override ? { ...rule, enabled: override.enabled, updatedAt: override.updatedAt } : rule);
  }
  for (const rule of stored) if (!byId.has(rule.id) && !rule.id.startsWith("repo:")) byId.set(rule.id, rule);
  return [...byId.values()];
}

export async function createRepoRule(repository: string, body: CreateRepoReviewRuleRequest): Promise<RepoReviewRule> {
  const rules = await readStoredRules(repository);
  const now = new Date().toISOString();
  const { dir } = await teamDir();
  const rule: RepoReviewRule = {
    id: `rule:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    repository,
    title: body.title.trim(),
    body: body.body.trim(),
    tone: body.tone?.trim() || "neutral",
    enabled: true,
    source: body.source?.trim() || "manual",
    createdAt: now,
    updatedAt: now,
    origin: dir ? "team" : "local"
  };
  await writeStoredRules(repository, [rule, ...rules]);
  return rule;
}

export async function updateRepoRule(repository: string, id: string, body: UpdateRepoReviewRuleRequest): Promise<RepoReviewRule | undefined> {
  const rules = await readStoredRules(repository);
  const index = rules.findIndex((rule) => rule.id === id);
  const now = new Date().toISOString();
  if (index < 0) {
    // Toggling a repository-committed rule: store a local/team override copy.
    const committed = (await repositoryRules(repository).catch(() => [])).find((rule) => rule.id === id);
    if (!committed) return undefined;
    const override: RepoReviewRule = { ...committed, enabled: typeof body.enabled === "boolean" ? body.enabled : committed.enabled, updatedAt: now };
    await writeStoredRules(repository, [override, ...rules]);
    return override;
  }
  const current = rules[index];
  const next: RepoReviewRule = {
    ...current,
    title: body.title?.trim() || current.title,
    body: body.body?.trim() || current.body,
    tone: body.tone?.trim() || current.tone,
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
    updatedAt: now
  };
  rules[index] = next;
  await writeStoredRules(repository, rules);
  return next;
}

/** The file maintainers commit so every reviewer (and every agent run) follows the same rules. */
export async function exportRepoRules(repository: string): Promise<RepoRulesExport> {
  const rules = (await listRepoRules(repository)).filter((rule) => rule.enabled);
  const content = JSON.stringify(
    {
      version: 1,
      repository,
      rules: rules.map((rule) => ({ id: rule.id.startsWith("repo:") ? rule.id.slice(5) : slug(rule.title), title: rule.title, body: rule.body, tone: rule.tone }))
    },
    null,
    2
  );
  return { path: repositoryRulesPath, content: `${content}\n`, rules: rules.length };
}

export function parseRepositoryRulesFile(repository: string, text: string): RepoReviewRule[] {
  const parsed = JSON.parse(text) as { rules?: unknown };
  if (!parsed || !Array.isArray(parsed.rules)) return [];
  const now = new Date(0).toISOString();
  const seen = new Set<string>();
  return parsed.rules
    .filter((item): item is { id?: string; title?: string; body?: string; tone?: string } => Boolean(item) && typeof item === "object")
    .map((item) => {
      const title = String(item.title ?? "").trim();
      const body = String(item.body ?? "").trim();
      const id = `repo:${slug(String(item.id ?? "") || title)}`;
      return { id, repository, title, body, tone: String(item.tone ?? "neutral").trim() || "neutral", enabled: true, source: "repository", createdAt: now, updatedAt: now, origin: "repository" as const };
    })
    .filter((rule) => rule.title && rule.body && !seen.has(rule.id) && seen.add(rule.id));
}

export function invalidateRepositoryRules(repository?: string): void {
  if (repository) repoRulesCache.delete(repository);
  else repoRulesCache.clear();
}

async function repositoryRules(repository: string): Promise<RepoReviewRule[]> {
  const cached = repoRulesCache.get(repository);
  if (cached && Date.now() - cached.fetchedAt < repoRulesTtlMs) return cached.rules;
  const token = await readGithubToken();
  if (!token) return [];
  let rules: RepoReviewRule[] = [];
  try {
    const result = await runCommand("gh", ["api", `repos/${repository}/contents/${repositoryRulesPath}`, "-q", ".content"], { env: githubCliEnv(token), redact: [token], timeoutMs: 30_000 });
    const text = Buffer.from(result.stdout.replace(/\s+/g, ""), "base64").toString("utf8");
    rules = parseRepositoryRulesFile(repository, text);
  } catch {
    rules = []; // 404 (no file) or offline: nothing committed, cache the miss.
  }
  repoRulesCache.set(repository, { fetchedAt: Date.now(), rules });
  return rules;
}

async function readStoredRules(repository: string): Promise<RepoReviewRule[]> {
  const local = await readLocalRules(repository);
  const team = await readTeamJson<RepoReviewRule[]>(repository, "rules.json");
  if (team === undefined) return local.map((rule) => ({ ...rule, origin: rule.origin ?? "local" }));
  // Team folder configured: team rules win; local rules not yet in the team file are still shown so nothing disappears.
  const ids = new Set(team.map((rule) => rule.id));
  return [...team.map((rule) => ({ ...rule, origin: "team" as const })), ...local.filter((rule) => !ids.has(rule.id)).map((rule) => ({ ...rule, origin: "local" as const }))];
}

async function writeStoredRules(repository: string, rules: RepoReviewRule[]): Promise<void> {
  const { dir } = await teamDir();
  if (dir) {
    const written = await writeTeamJson(repository, "rules.json", rules.map((rule) => ({ ...rule, origin: undefined })));
    if (written) return;
  }
  await writeLocalRules(repository, rules.map((rule) => ({ ...rule, origin: undefined })));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "rule";
}
