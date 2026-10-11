import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId, AgentTask, AgentUsageEntry, AgentUsageSummary, ModelTier } from "../shared/types.js";
import { cacheDir } from "./paths.js";

/**
 * Agent usage ledger.
 *
 * Every agent run records what it was for, which agent/model/tier ran it, how
 * long it took and (when the CLI reports it, currently Claude Code) what it
 * cost. The ledger answers "what has this PR cost us so far?" and makes the
 * economy/standard tier split visible instead of theoretical.
 */
const ledgerPath = join(cacheDir, "agent-usage.json");
const maxEntries = 5000;
let cached: AgentUsageEntry[] | undefined;
let writing: Promise<void> = Promise.resolve();

export async function recordAgentUsage(entry: {
  prKey?: string;
  task: AgentTask;
  agent: AgentId;
  model: string;
  tier: ModelTier;
  durationMs: number;
  costUsd?: number;
  sessionId?: string;
  ok: boolean;
}): Promise<void> {
  const entries = await readLedger();
  entries.push({ ...entry, at: new Date().toISOString() });
  if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
  cached = entries;
  writing = writing.then(async () => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(ledgerPath, JSON.stringify(entries, null, 2));
  }).catch(() => undefined);
  await writing;
}

export async function usageSummary(prKey?: string): Promise<AgentUsageSummary> {
  const entries = (await readLedger()).filter((entry) => !prKey || entry.prKey === prKey);
  return summarizeUsage(entries, prKey);
}

export function summarizeUsage(entries: AgentUsageEntry[], prKey?: string): AgentUsageSummary {
  const byTask: AgentUsageSummary["byTask"] = {};
  const byAgent: AgentUsageSummary["byAgent"] = {};
  let totalCostUsd = 0;
  let runsWithCost = 0;
  let totalDurationMs = 0;
  for (const entry of entries) {
    totalDurationMs += entry.durationMs;
    if (typeof entry.costUsd === "number") {
      totalCostUsd += entry.costUsd;
      runsWithCost += 1;
    }
    const task = (byTask[entry.task] ??= { runs: 0, costUsd: 0, durationMs: 0 });
    task.runs += 1;
    task.costUsd += entry.costUsd ?? 0;
    task.durationMs += entry.durationMs;
    const agent = (byAgent[entry.agent] ??= { runs: 0, costUsd: 0, durationMs: 0 });
    agent.runs += 1;
    agent.costUsd += entry.costUsd ?? 0;
    agent.durationMs += entry.durationMs;
  }
  return {
    prKey,
    runs: entries.length,
    runsWithCost,
    totalCostUsd: Math.round(totalCostUsd * 10_000) / 10_000,
    totalDurationMs,
    byTask,
    byAgent,
    recent: entries.slice(-20).reverse()
  };
}

async function readLedger(): Promise<AgentUsageEntry[]> {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(await readFile(ledgerPath, "utf8")) as unknown;
    cached = Array.isArray(parsed) ? (parsed as AgentUsageEntry[]) : [];
  } catch {
    cached = [];
  }
  return cached;
}

/** Test hook. */
export function resetUsageCache(): void {
  cached = undefined;
}
