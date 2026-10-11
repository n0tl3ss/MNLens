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
