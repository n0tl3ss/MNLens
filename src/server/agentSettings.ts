import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId, AgentSettings, AgentTask, ModelTier, TierModel, UpdateAgentSettingsRequest } from "../shared/types.js";
import { cacheDir } from "./paths.js";

const settingsPath = join(cacheDir, "agent-settings.json");

export const agentIds: AgentId[] = ["codex", "claude"];
export const modelTiers: ModelTier[] = ["economy", "standard", "premium"];

export const agentTasks: AgentTask[] = [
  "analysis-reading",
  "deep-analysis",
  "quick-answer",
  "ci-explain",
  "fix-implementation",
  "fix-tests-qa",
  "fix-final-review",
  "fix-qa-assessment",
  "fix-question",
  "conflict-resolution",
  "manual-check",
  "second-opinion",
  "acceptance-contract",
  "review-draft",
  "setup-probe"
];

/**
 * Default model ladder per agent.
 *
 * Prices (USD per 1M input/output tokens, Oct 2026 list prices):
 *   Claude  haiku  ~0.10/0.50   sonnet ~2/10        opus ~4/20
 *   OpenAI  gpt-6-luna 0.10/0.50  gpt-6.1-sol 2/10  gpt-6-astra 10/50
 *
 * Claude aliases (haiku/sonnet/opus) always resolve to the newest model of
 * that family in Claude Code, so they do not need updating on each release.
 * OpenAI ids are explicit because Codex has no alias mechanism; they are
 * editable in Settings or via MNLENS_AGENT_SETTINGS_JSON.
 */
export const defaultTierModels: Record<AgentId, Record<ModelTier, TierModel>> = {
  claude: {
    economy: { model: "haiku", effort: "low" },
    standard: { model: "sonnet", effort: "medium" },
    premium: { model: "opus", effort: "high" }
  },
  codex: {
    economy: { model: "gpt-6-luna", effort: "low" },
    standard: { model: "gpt-6.1-sol", effort: "medium" },
    premium: { model: "gpt-6-astra", effort: "high" }
  }
};

/**
 * Which tier each MNLens task runs on by default.
 *
 * Rationale: anything that needs to *edit code* or *judge correctness of a
 * patch* runs on the standard tier. Anything that mostly summarizes or
 * explains context MNLens already fetched (risk Q&A, CI log explanation,
 * QA failure classification) runs on the
 * economy tier, where the price is roughly 20x lower. Premium is never the
 * default; reviewers opt in per task when a PR is unusually hard.
 *
 * Deep Analyze is two runs: the reading pass does the judging inside the PR
 * checkout, the extraction pass only rewrites its notes into the analysis
 * schema. Both default to standard: measured on micronaut-micrometer#1259,
 * haiku took 4x longer than sonnet on the extraction (248s vs 57s, three
 * structured-output turns), cost the same ($0.19) and invented line numbers
 * the notes did not contain. See AGENTS.md.
 */
export const defaultTaskTiers: Record<AgentTask, ModelTier> = {
  "analysis-reading": "standard",
  "deep-analysis": "standard",
  "quick-answer": "economy",
  "ci-explain": "economy",
  "fix-implementation": "standard",
  "fix-tests-qa": "standard",
  "fix-final-review": "standard",
  "fix-qa-assessment": "economy",
  "fix-question": "economy",
  "conflict-resolution": "standard",
  "manual-check": "economy",
  "second-opinion": "economy",
  "acceptance-contract": "standard",
  "review-draft": "standard",
  "setup-probe": "economy"
};

export const taskDescriptions: Record<AgentTask, string> = {
  "analysis-reading": "Deep Analyze: reading pass (reads the PR checkout, writes review notes)",
  "deep-analysis": "Deep Analyze: extraction pass (turns the notes into the structured review)",
  "quick-answer": "Ask about a risk / focus item",
  "ci-explain": "Explain a failing CI check",
  "fix-implementation": "Fix pipeline: implementation pass",
  "fix-tests-qa": "Fix pipeline: tests/QA pass",
  "fix-final-review": "Fix pipeline: final review pass",
  "fix-qa-assessment": "Fix pipeline: classify verification failures",
  "fix-question": "Ask a question about a fix session",
  "conflict-resolution": "Resolve rebase/merge conflicts",
  "manual-check": "Investigate a manual verification item",
  "second-opinion": "Second opinion: other agent audits an analysis",
  "acceptance-contract": "Acceptance contract: map issue/PR criteria to evidence",
  "review-draft": "Review draft: suggested inline comments and final verdict",
  "setup-probe": "Setup screen auth/model probe"
};

export function defaultAgentSettings(): AgentSettings {
  return {
    agent: (process.env.MNLENS_AGENT as AgentId | undefined) && agentIds.includes(process.env.MNLENS_AGENT as AgentId) ? (process.env.MNLENS_AGENT as AgentId) : "codex",
    tiers: structuredClone(defaultTierModels),
    taskTiers: { ...defaultTaskTiers },
    maxBudgetUsdPerRun: undefined,
    claudeMcpConfig: undefined,
    updatedAt: new Date(0).toISOString()
  };
}

let cached: AgentSettings | undefined;

export async function readAgentSettings(): Promise<AgentSettings> {
  if (cached) return cached;
  const base = defaultAgentSettings();
  let stored: SettingsPatch | undefined;
  try {
    stored = JSON.parse(await readFile(settingsPath, "utf8")) as SettingsPatch;
  } catch {
    stored = undefined;
  }
  const envOverride = parseEnvOverride();
  cached = mergeSettings(mergeSettings(base, stored), envOverride);
  return cached;
}

export async function updateAgentSettings(patch: UpdateAgentSettingsRequest): Promise<AgentSettings> {
  const current = await readAgentSettings();
  const next = mergeSettings(current, { ...patch, updatedAt: new Date().toISOString() });
  validateSettings(next);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(settingsPath, JSON.stringify(next, null, 2));
  cached = next;
  return next;
}

export async function resetAgentSettings(): Promise<AgentSettings> {
  const next = { ...defaultAgentSettings(), updatedAt: new Date().toISOString() };
  await mkdir(cacheDir, { recursive: true });
  await writeFile(settingsPath, JSON.stringify(next, null, 2));
  cached = next;
  return next;
}

/** Test hook: forget cached settings so the next read hits disk/env again. */
export function resetAgentSettingsCache(): void {
  cached = undefined;
}

export function resolveTierModel(settings: AgentSettings, agent: AgentId, task: AgentTask, tierOverride?: ModelTier): { tier: ModelTier; model: string; effort?: string } {
  const tier = tierOverride ?? settings.taskTiers[task] ?? defaultTaskTiers[task];
  const tierModel = settings.tiers[agent]?.[tier] ?? defaultTierModels[agent][tier];
  return { tier, model: tierModel.model, effort: tierModel.effort };
}

type SettingsPatch = Partial<Pick<AgentSettings, "agent" | "updatedAt">> & UpdateAgentSettingsRequest;

export function mergeSettings(base: AgentSettings, patch: SettingsPatch | undefined): AgentSettings {
  if (!patch) return base;
  const tiers = structuredClone(base.tiers);
  for (const agent of agentIds) {
    const patchTiers = patch.tiers?.[agent];
    if (!patchTiers) continue;
    for (const tier of modelTiers) {
      const value = patchTiers[tier];
      if (!value || typeof value !== "object") continue;
      tiers[agent][tier] = {
        model: typeof value.model === "string" && value.model.trim() ? value.model.trim() : tiers[agent][tier].model,
        effort: typeof value.effort === "string" && value.effort.trim() ? value.effort.trim() : value.effort === null ? undefined : tiers[agent][tier].effort
      };
    }
  }
  const taskTiers = { ...base.taskTiers };
  for (const [task, tier] of Object.entries(patch.taskTiers ?? {})) {
    if (agentTasks.includes(task as AgentTask) && modelTiers.includes(tier as ModelTier)) taskTiers[task as AgentTask] = tier as ModelTier;
  }
  return {
    agent: patch.agent && agentIds.includes(patch.agent) ? patch.agent : base.agent,
    tiers,
    taskTiers,
    maxBudgetUsdPerRun:
      patch.maxBudgetUsdPerRun === null
        ? undefined
        : typeof patch.maxBudgetUsdPerRun === "number" && Number.isFinite(patch.maxBudgetUsdPerRun) && patch.maxBudgetUsdPerRun > 0
          ? patch.maxBudgetUsdPerRun
          : base.maxBudgetUsdPerRun,
    claudeMcpConfig:
      patch.claudeMcpConfig === null
        ? undefined
        : typeof patch.claudeMcpConfig === "string"
          ? patch.claudeMcpConfig.trim() || undefined
          : base.claudeMcpConfig,
    updatedAt: patch.updatedAt ?? base.updatedAt
  };
}

function validateSettings(settings: AgentSettings): void {
  if (!agentIds.includes(settings.agent)) throw new Error(`Unknown agent "${settings.agent}". Expected one of ${agentIds.join(", ")}.`);
  if (settings.claudeMcpConfig && (!settings.claudeMcpConfig.endsWith(".json") || /[\r\n]/.test(settings.claudeMcpConfig))) {
    throw new Error("The Claude MCP config must be the path of a .json file in Claude Code's mcpServers format.");
  }
  for (const agent of agentIds) {
    for (const tier of modelTiers) {
      const model = settings.tiers[agent][tier].model;
      if (!/^[A-Za-z0-9._:-]+$/.test(model)) throw new Error(`Invalid model id "${model}" for ${agent}/${tier}.`);
      const effort = settings.tiers[agent][tier].effort;
      if (effort && !/^[a-z]+$/.test(effort)) throw new Error(`Invalid effort "${effort}" for ${agent}/${tier}.`);
    }
  }
}

function parseEnvOverride(): SettingsPatch | undefined {
  const raw = process.env.MNLENS_AGENT_SETTINGS_JSON;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as SettingsPatch;
  } catch {
    return undefined;
  }
}
