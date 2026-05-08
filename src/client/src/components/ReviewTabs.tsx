import { Loader2, RefreshCw } from "lucide-react";
import type { Tab } from "../reviewTypes";
import "./reviewTabs.css";

const tabs: Tab[] = ["overview", "plan", "diff", "commits", "research", "fix", "comment", "handoff"];

export function ReviewTabs({
  active,
  refreshing,
  onChange,
  onRefresh
}: {
  active: Tab;
  refreshing: boolean;
  onChange: (tab: Tab) => void;
  onRefresh: () => void;
}) {
  return (
    <nav className="tabs">
      <div className="tab-list">
        {tabs.map((tab) => (
          <button key={tab} className={active === tab ? "active" : ""} onClick={() => onChange(tab)}>
            {tabLabel(tab)}
          </button>
        ))}
      </div>
      <button className="tab-refresh icon-button" disabled={refreshing} onClick={onRefresh} title="Refresh PR details, commits, comments, CI status, local jobs, and cached review data.">
        {refreshing ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
      </button>
    </nav>
  );
}

function tabLabel(tab: Tab): string {
  if (tab === "fix") return "Codex";
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}
