import { useEffect, useState } from "react";
import { Bot, RotateCcw, X } from "lucide-react";
import type { AgentId, AgentSettings, AgentTask, ModelTier, UpdateAgentSettingsRequest } from "../../../shared/types";
import type { AgentSettingsResponse } from "../api";
import { Badge } from "./uiBits";
import "./agentSettings.css";

const tiers: ModelTier[] = ["economy", "standard", "premium"];
const agents: AgentId[] = ["codex", "claude"];

export const agentLabels: Record<AgentId, string> = { codex: "Codex", claude: "Claude Code" };

const tierHints: Record<ModelTier, string> = {
  economy: "Summaries, Q&A, docs, classification. ~$0.10 / $0.50 per 1M tokens on either vendor.",
  standard: "Code edits, test writing, review judgment. ~$2 / $10 per 1M tokens on either vendor.",
  premium: "Hard PRs only. 2–5x the standard price; never the default."
};

const effortOptions: Record<AgentId, string[]> = {
  claude: ["low", "medium", "high"],
  codex: ["minimal", "low", "medium", "high", "xhigh"]
};

/**
 * Lets the reviewer pick the agent CLI and the model ladder it runs on.
 * Settings persist server-side (cache dir) so Electron and browser sessions agree.
 */
export function AgentSettingsDialog({
  data,
  availableAgents,
  saving,
  error,
  onClose,
  onSave,
  onReset
}: {
  data?: AgentSettingsResponse;
  availableAgents: AgentId[];
  saving: boolean;
  error?: string;
  onClose: () => void;
  onSave: (patch: UpdateAgentSettingsRequest) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<AgentSettings | undefined>(data?.settings);
  useEffect(() => setDraft(data?.settings), [data?.settings]);
  if (!draft || !data) {
    return (
      <div className="agent-settings-backdrop" role="dialog" aria-modal="true">
        <div className="agent-settings">
          <p className="muted">Loading agent settings...</p>
        </div>
      </div>
    );
  }

  function setTierModel(agent: AgentId, tier: ModelTier, patch: Partial<{ model: string; effort: string }>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            tiers: { ...current.tiers, [agent]: { ...current.tiers[agent], [tier]: { ...current.tiers[agent][tier], ...patch } } }
          }
        : current
    );
  }

  function setTaskTier(task: AgentTask, tier: ModelTier) {
    setDraft((current) => (current ? { ...current, taskTiers: { ...current.taskTiers, [task]: tier } } : current));
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);

  return (
    <div className="agent-settings-backdrop" role="dialog" aria-modal="true" aria-label="Agent and model settings" onClick={onClose}>
      <div className="agent-settings" onClick={(event) => event.stopPropagation()}>
        <header>
          <h3>
            <Bot size={18} /> Agent & models
          </h3>
          <button type="button" className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </header>

        <section className="agent-settings-section">
          <h4>Coding agent</h4>
          <p className="muted">MNLens drives one locally installed agent CLI for Deep Analyze, Q&A, fix sessions, conflict resolution and manual checks. Both agents get the same prompts, schemas and human approval gates.</p>
          <div className="agent-choice">
            {agents.map((agent) => {
              const available = availableAgents.includes(agent);
              return (
                <label key={agent} className={`agent-option ${draft.agent === agent ? "selected" : ""} ${available ? "" : "unavailable"}`}>
                  <input type="radio" name="agent" value={agent} checked={draft.agent === agent} onChange={() => setDraft({ ...draft, agent })} />
                  <span>
                    <strong>{agentLabels[agent]}</strong>
                    {available ? <Badge tone="added">ready</Badge> : <Badge tone="review-needed">not detected</Badge>}
                  </span>
                  <em className="muted">{agent === "codex" ? "codex exec · OpenAI models" : "claude -p · Anthropic models"}</em>
                </label>
              );
            })}
          </div>
        </section>

        <section className="agent-settings-section">
          <h4>Model ladder</h4>
          <div className="tier-grid">
            <span />
            {agents.map((agent) => (
              <strong key={agent}>{agentLabels[agent]}</strong>
            ))}
            {tiers.map((tier) => (
              <div key={tier} className="tier-row">
                <div className="tier-label">
                  <strong>{tier}</strong>
                  <em className="muted">{tierHints[tier]}</em>
                </div>
                {agents.map((agent) => (
                  <div key={agent} className="tier-cell">
                    <input
                      type="text"
                      value={draft.tiers[agent][tier].model}
                      spellCheck={false}
                      onChange={(event) => setTierModel(agent, tier, { model: event.target.value })}
                      placeholder={data.defaults.tiers[agent][tier].model}
                    />
                    <select value={draft.tiers[agent][tier].effort ?? ""} onChange={(event) => setTierModel(agent, tier, { effort: event.target.value })}>
                      <option value="">effort: default</option>
                      {effortOptions[agent].map((effort) => (
                        <option key={effort} value={effort}>
                          effort: {effort}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="muted">
            Claude aliases (<code>haiku</code>, <code>sonnet</code>, <code>opus</code>) always resolve to the newest model of that family. OpenAI ids are explicit; keep them in sync with what your ChatGPT/API account exposes to Codex.
          </p>
        </section>

        <section className="agent-settings-section">
          <h4>Which tier each task uses</h4>
          <div className="task-grid">
            {data.tasks.map(({ task, description }) => (
              <label key={task} className="task-row">
                <span>
                  <strong>{description}</strong>
                  <em className="muted">{task}</em>
                </span>
                <select value={draft.taskTiers[task]} onChange={(event) => setTaskTier(task, event.target.value as ModelTier)}>
                  {tiers.map((tier) => (
                    <option key={tier} value={tier}>
                      {tier} · {draft.tiers[draft.agent][tier].model}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>

        <section className="agent-settings-section">
          <h4>Spend guard</h4>
          <label className="budget-row">
            <span>
              <strong>Max budget per Claude run (USD)</strong>
              <em className="muted">Passed as <code>--max-budget-usd</code>. Codex has no equivalent flag; its cost is bounded by the chosen model and effort.</em>
            </span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={draft.maxBudgetUsdPerRun ?? ""}
              placeholder="unlimited"
              onChange={(event) => setDraft({ ...draft, maxBudgetUsdPerRun: event.target.value ? Number(event.target.value) : undefined })}
            />
          </label>
        </section>

        {error && <p className="agent-settings-error">{error}</p>}

        <footer>
          <button type="button" className="ghost" onClick={onReset} disabled={saving} title="Restore the default ladder and task tiers">
            <RotateCcw size={14} /> Reset defaults
          </button>
          <span className="agent-settings-footer-actions">
            <button type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={saving || !dirty}
              onClick={() =>
                onSave({
                  agent: draft.agent,
                  tiers: draft.tiers,
                  taskTiers: draft.taskTiers,
                  maxBudgetUsdPerRun: draft.maxBudgetUsdPerRun ?? null
                })
              }
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
