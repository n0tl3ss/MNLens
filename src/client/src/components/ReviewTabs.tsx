import { Loader2, RefreshCw } from "lucide-react";
import type { Tab } from "../reviewTypes";
import "./reviewTabs.css";

/**
 * Tabs are grouped in the order a review actually runs:
 *   Understand  → what changed and why (Overview, Research, Commits)
 *   Review      → the agent's recommended review, the guided plan, the diff
 *   Act         → fix with the agent, draft comments, hand off
 */
const tabGroups: { label: string; tabs: Tab[] }[] = [
  { label: "Understand", tabs: ["overview", "research", "commits"] },
  { label: "Review", tabs: ["review", "plan", "diff"] },
  { label: "Act", tabs: ["fix", "comment", "handoff"] }
];

const tabTitles: Record<Tab, string> = {
  overview: "Deep analysis, acceptance contract, CI and the recommendation.",
  research: "Docs and similar implementations the agent found for this change.",
  commits: "Commit-by-commit timeline of the PR.",
  review: "The review the agent would post: inline comments, final comment, verdict — and what you must / should / may do first.",
  plan: "Guided step-by-step review checklist.",
  diff: "Read the diff and leave your own comments.",
  fix: "Let the agent fix findings in a sandboxed checkout; you approve the push.",
  comment: "Your draft review comments and the PR conversation.",
  handoff: "Summary for another reviewer and feedback to the author."
};

export function ReviewTabs({
  active,
  refreshing,
  agentLabel,
  badges,
  onChange,
  onRefresh
}: {
  active: Tab;
  refreshing: boolean;
  /** Display name of the selected coding agent; labels the Fix tab (defaults to "Codex"). */
  agentLabel?: string;
  /** Small counters shown next to a tab label (e.g. number of draft comments). */
  badges?: Partial<Record<Tab, number | string>>;
  onChange: (tab: Tab) => void;
  onRefresh: () => void;
}) {
  return (
    <nav className="tabs">
      <div className="tab-list">
        {tabGroups.map((group) => (
          <div key={group.label} className="tab-group" role="group" aria-label={group.label}>
            <span className="tab-group-label">{group.label}</span>
            {group.tabs.map((tab) => (
              <button key={tab} className={active === tab ? "active" : ""} onClick={() => onChange(tab)} title={tabTitles[tab]}>
                {tabLabel(tab, agentLabel)}
                {badges?.[tab] !== undefined && badges[tab] !== 0 && <span className="tab-badge">{badges[tab]}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
      <button className="tab-refresh icon-button" disabled={refreshing} onClick={onRefresh} title="Refresh PR details, commits, comments, CI status, local jobs, and cached review data.">
        {refreshing ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
      </button>
    </nav>
  );
}

function tabLabel(tab: Tab, agentLabel = "Codex"): string {
  if (tab === "fix") return agentLabel;
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}
