import type { AgentId, SetupStatus } from "../../shared/types";

/**
 * Agents that are installed and signed in. Prefers the server's `availableAgents`;
 * derives it from the dependency groups for older/mocked payloads, and treats a
 * payload with no agent-group checks at all as "agent ready" (legacy single-agent setups).
 */
export function availableAgentsFrom(status: SetupStatus | undefined): AgentId[] | undefined {
  if (!status) return undefined;
  if (Array.isArray(status.availableAgents)) return status.availableAgents;
  const grouped = status.dependencies.filter((item) => item.group);
  if (grouped.length === 0) return ["codex"];
  const agents = [...new Set(grouped.map((item) => item.group as AgentId))];
  return agents.filter((agent) => grouped.filter((item) => item.group === agent).every((item) => item.installed));
}

export type AgentHealthState = "ready" | "signed-out" | "missing" | "unknown";

export interface AgentHealth {
  agent: AgentId;
  state: AgentHealthState;
  /** The other vendor, which the second opinion uses. */
  other: AgentId;
  otherState: AgentHealthState;
}

/** Install / sign-in state of both agent CLIs from the setup probe, for the sidebar chip. */
export function agentHealthFrom(status: SetupStatus | undefined): AgentHealth | undefined {
  if (!status?.selectedAgent) return undefined;
  const agent = status.selectedAgent;
  const other: AgentId = agent === "claude" ? "codex" : "claude";
  return { agent, state: agentState(status, agent), other, otherState: agentState(status, other) };
}

function agentState(status: SetupStatus, agent: AgentId): AgentHealthState {
  const checks = status.dependencies.filter((item) => item.group === agent);
  if (checks.length === 0) return availableAgentsFrom(status)?.includes(agent) ? "ready" : "unknown";
  const cli = checks.find((item) => item.id === agent);
  if (cli && !cli.installed) return "missing";
  if (checks.some((item) => item.id === `${agent}-auth` && !item.installed)) return "signed-out";
  return checks.every((item) => item.installed) ? "ready" : "unknown";
}

export function agentHealthLabel(state: AgentHealthState): string {
  if (state === "ready") return "ready";
  if (state === "signed-out") return "signed out";
  if (state === "missing") return "not installed";
  return "unchecked";
}
