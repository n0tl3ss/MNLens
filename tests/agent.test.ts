import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractAgentSessionId, parseAgentOutput, parseClaudeOutput, prepareAgentRun } from "../src/server/agent";
import { defaultAgentSettings, mergeSettings, resetAgentSettingsCache, resolveTierModel } from "../src/server/agentSettings";

describe("agent settings", () => {
  beforeEach(() => resetAgentSettingsCache());
  afterEach(() => {
    delete process.env.MNLENS_AGENT_SETTINGS_JSON;
    delete process.env.MNLENS_AGENT;
    resetAgentSettingsCache();
  });

  it("routes cheap tasks to the economy tier and code-changing tasks to standard by default", () => {
    const settings = defaultAgentSettings();
    expect(resolveTierModel(settings, "claude", "quick-answer").model).toBe("haiku");
    expect(resolveTierModel(settings, "claude", "fix-implementation").model).toBe("sonnet");
    expect(resolveTierModel(settings, "codex", "ci-explain").model).toBe("gpt-6-luna");
    expect(resolveTierModel(settings, "codex", "deep-analysis").model).toBe("gpt-6.1-sol");
    expect(Object.values(settings.taskTiers)).not.toContain("premium");
  });

  it("merges partial patches without losing defaults", () => {
    const merged = mergeSettings(defaultAgentSettings(), {
      agent: "claude",
      tiers: { claude: { premium: { model: "opus", effort: "high" } }, codex: { economy: { model: "gpt-6-luna", effort: null } } },
      taskTiers: { "deep-analysis": "premium", "not-a-task": "economy" } as never
    });
    expect(merged.agent).toBe("claude");
    expect(merged.tiers.claude.standard.model).toBe("sonnet");
    expect(merged.tiers.codex.economy.effort).toBeUndefined();
    expect(merged.taskTiers["deep-analysis"]).toBe("premium");
    expect((merged.taskTiers as Record<string, unknown>)["not-a-task"]).toBeUndefined();
  });

  it("honours a tier override for a single run", () => {
    expect(resolveTierModel(defaultAgentSettings(), "claude", "quick-answer", "premium").model).toBe("opus");
  });
});

describe("agent invocations", () => {
  beforeEach(() => resetAgentSettingsCache());
  afterEach(() => {
    delete process.env.MNLENS_AGENT_SETTINGS_JSON;
    resetAgentSettingsCache();
  });

  it("builds a read-only Claude Code invocation with structured output and no edit tools", async () => {
    process.env.MNLENS_AGENT_SETTINGS_JSON = JSON.stringify({ agent: "claude" });
    const invocation = await prepareAgentRun({
      task: "deep-analysis",
      prompt: "hello",
      access: "read-only",
      cwd: "/tmp",
      webSearch: true,
      outputSchema: { type: "object" }
    });
    expect(invocation.command).toBe("claude");
    expect(invocation.args).toEqual(expect.arrayContaining(["-p", "--output-format", "json", "--model", "sonnet", "--effort", "medium", "--permission-mode", "dontAsk", "--permission-prompts", "none", "--json-schema", '{"type":"object"}']));
    expect(invocation.args).toContain("Edit");
    expect(invocation.args).not.toContain("WebSearch");
    expect(invocation.args).not.toContain("--resume");
    expect(invocation.args).toContain("--no-session-persistence");
    expect(invocation.input).toBe("hello");
    expect(invocation.label).toBe("Claude (sonnet)");
  });

  it("builds a resumable full-access Claude Code invocation for fix passes", async () => {
    process.env.MNLENS_AGENT_SETTINGS_JSON = JSON.stringify({ agent: "claude", maxBudgetUsdPerRun: 3 });
    const invocation = await prepareAgentRun({ task: "fix-implementation", prompt: "fix", access: "full-access", cwd: "/tmp", sessionId: "abc" });
    expect(invocation.args).toEqual(expect.arrayContaining(["--resume", "abc", "--permission-mode", "bypassPermissions", "--max-budget-usd", "3", "--output-format", "stream-json", "--verbose"]));
    expect(invocation.args).not.toContain("--no-session-persistence");
    expect(invocation.args).not.toContain("Edit");
    expect(invocation.args).toEqual(expect.arrayContaining(["--disallowedTools", "WebSearch", "WebFetch"]));
  });

  it("builds Codex invocations with model + reasoning effort and keeps the stdin prompt marker last", async () => {
    process.env.MNLENS_AGENT_SETTINGS_JSON = JSON.stringify({ agent: "codex" });
    const fresh = await prepareAgentRun({ task: "quick-answer", prompt: "q", access: "read-only", cwd: "/tmp", webSearch: true, outputSchema: { type: "object" }, outputLastMessagePath: "/tmp/out.json" });
    expect(fresh.command).toBe("codex");
    expect(fresh.args.slice(0, 4)).toEqual(["-m", "gpt-6-luna", "-c", 'model_reasoning_effort="low"']);
    expect(fresh.args).toEqual(expect.arrayContaining(["--search", "exec", "--sandbox", "read-only", "--output-schema", "/tmp/out.json.schema.json", "--output-last-message", "/tmp/out.json"]));
    expect(fresh.args.at(-1)).toBe("-");
    expect(fresh.env.CODEX_HOME).toContain("codex-home");

    const resumed = await prepareAgentRun({ task: "fix-tests-qa", prompt: "q", access: "full-access", cwd: "/tmp", sessionId: "thread-1" });
    expect(resumed.args).toEqual(["-m", "gpt-6.1-sol", "-c", 'model_reasoning_effort="medium"', "exec", "resume", "--skip-git-repo-check", "thread-1", "-"]);
  });
});

describe("agent output parsing", () => {
  it("parses a Claude json envelope", () => {
    const parsed = parseClaudeOutput(
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "FIX_ANSWER: looks fine", session_id: "550e8400-e29b-41d4-a716-446655440000", total_cost_usd: 0.0123, structured_output: { type: "bug" } })
    );
    expect(parsed.text).toBe("FIX_ANSWER: looks fine");
    expect(parsed.sessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(parsed.costUsd).toBeCloseTo(0.0123);
    expect(parsed.structured).toEqual({ type: "bug" });
    expect(parsed.isError).toBe(false);
  });

  it("finds the result line in a stream-json transcript and ignores noise", () => {
    const stdout = [
      "Warning: something",
      JSON.stringify({ type: "system", subtype: "init", session_id: "11111111-1111-1111-1111-111111111111" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "working" }] } }),
      JSON.stringify({ type: "result", result: "done", session_id: "11111111-1111-1111-1111-111111111111" })
    ].join("\n");
    expect(parseClaudeOutput(stdout).text).toBe("done");
  });

  it("falls back to raw text when Claude printed no envelope", () => {
    expect(parseClaudeOutput("plain text").text).toBe("plain text");
  });

  it("recovers session ids from either agent's log format", () => {
    expect(extractAgentSessionId("codex\nsession id: 123e4567-e89b-12d3-a456-426614174000\n", "codex")).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(extractAgentSessionId('{"type":"result","session_id":"123e4567-e89b-12d3-a456-426614174999"}', "claude")).toBe("123e4567-e89b-12d3-a456-426614174999");
    expect(extractAgentSessionId("nothing here")).toBeUndefined();
    expect(parseAgentOutput("codex", "session id: 123e4567-e89b-12d3-a456-426614174000\nanswer").text).toContain("answer");
  });
});

describe("claude stream log formatting", () => {
  it("renders NDJSON events as a compact transcript with a session id line", async () => {
    const { createAgentLogFormatter } = await import("../src/server/agent");
    const format = createAgentLogFormatter("claude");
    const first = format(JSON.stringify({ type: "system", subtype: "init", session_id: "11111111-1111-1111-1111-111111111111", model: "claude-sonnet" }) + "\n" + '{"type":"assistant","message":{"content":[{"type":"text","text":"Reading tests"},{"type":"tool_use","name":"Bash","input":{"command":"./gradlew :core:test"}}]}}\n{"type":"user","message":{"content":[{"type":"tool_result","content":"BUILD SUCCESSFUL in 4s"}]}}\n');
    expect(first).toContain("session id: 11111111-1111-1111-1111-111111111111");
    expect(first).toContain("model: claude-sonnet");
    expect(first).toContain("→ Bash ./gradlew :core:test");
    expect(first).toContain("← BUILD SUCCESSFUL in 4s");
    // Partial line is buffered until the newline arrives.
    expect(format('{"type":"result","result":"done","total_cost_usd":0.0')).toBe("");
    expect(format('5,"num_turns":3}\n')).toContain("[claude result · 3 turns · ~$0.050]");
    expect(createAgentLogFormatter("codex")("raw codex text")).toBe("raw codex text");
  });
});
