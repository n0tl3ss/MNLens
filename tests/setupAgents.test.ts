import { describe, expect, it } from "vitest";
import { agentHealthFrom, agentHealthLabel } from "../src/client/src/setupAgents";
import type { DependencyCheck, SetupStatus } from "../src/shared/types";

const check = (id: string, group: "codex" | "claude", installed: boolean): DependencyCheck => ({ id, name: id, required: true, installed, installHint: "", group });

function status(dependencies: DependencyCheck[], selectedAgent: "codex" | "claude" = "claude"): SetupStatus {
  return { checkedAt: "", platform: "darwin", ready: true, dependencies, availableAgents: [], selectedAgent };
}

describe("agent health for the sidebar chip", () => {
  it("reads install and sign-in state of both agents from the setup probe", () => {
    const health = agentHealthFrom(status([check("claude", "claude", true), check("claude-auth", "claude", true), check("codex", "codex", true), check("codex-auth", "codex", false)]));
    expect(health).toEqual({ agent: "claude", state: "ready", other: "codex", otherState: "signed-out" });
    expect(agentHealthFrom(status([check("claude", "claude", false), check("claude-auth", "claude", false)]))?.state).toBe("missing");
    expect(agentHealthLabel("signed-out")).toBe("signed out");
  });

  it("falls back to the server's availableAgents when the probe has no per-agent checks", () => {
    const payload = { ...status([]), availableAgents: ["codex" as const] };
    expect(agentHealthFrom(payload)).toEqual({ agent: "claude", state: "unknown", other: "codex", otherState: "ready" });
    expect(agentHealthFrom(undefined)).toBeUndefined();
  });
});
