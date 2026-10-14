import { History } from "lucide-react";
import { useState } from "react";
import type { AnalysisDelta, AnalysisDeltaItem } from "../../../shared/types";
import { deltaKindLabel, deltaKindTone, deltaSummary, deltaTone, insightSectionId, sortDeltaItems } from "../analysisDeltaHelpers";
import { verdictKey } from "./InsightSection";
import { Badge, relativeDate } from "./uiBits";

const visibleLimit = 5;

/**
 * "Since the last analysis": what a Deep Analyze re-run on new commits resolved,
 * what it added and how much is unchanged, so the reviewer reads only the delta.
 * Verdicts already given on persisting findings are shown as such; the server
 * copied them onto reworded titles (see server/analysisDelta.ts).
 */
export function AnalysisDeltaSection({ delta, verdicts }: { delta: AnalysisDelta; verdicts?: Record<string, "kept" | "dismissed"> }) {
  const [showAll, setShowAll] = useState(false);
  const resolved = sortDeltaItems(delta.resolved);
  const added = sortDeltaItems(delta.added);
  const judged = delta.persisting.filter((item) => verdicts?.[verdictKey(item.kind, item.title)]).length;
  const severityChanged = delta.persisting.filter((item) => item.previousSeverity);
  const tone = deltaTone(delta);
  const hidden = Math.max(0, resolved.length - visibleLimit) + Math.max(0, added.length - visibleLimit);
  const limit = showAll ? Number.POSITIVE_INFINITY : visibleLimit;

  function jumpTo(item: AnalysisDeltaItem) {
    document.getElementById(insightSectionId(deltaKindTone[item.kind]))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className={`summary-card analysis-delta-card ${tone}`} aria-label="Since the last analysis">
      <div className="panel-title">
        <div>
          <h3>Since the last analysis</h3>
          <p className="muted">
            Compared with the analysis from {relativeDate(delta.previousGeneratedAt)} on the previous diff: {deltaSummary(delta)}.
          </p>
        </div>
        <History size={18} />
      </div>
      {resolved.length === 0 && added.length === 0 ? (
        <p className="analysis-delta-persisting">The new commits did not change the findings; every item below was already raised last time.</p>
      ) : (
        <div className="analysis-delta-columns">
          {resolved.length > 0 && (
            <div>
              <h4>No longer raised</h4>
              <ul className="analysis-delta-list">
                {resolved.slice(0, limit).map((item) => (
                  <li key={`${item.kind}:${item.title}`} className="resolved">
                    <Badge tone="added">resolved</Badge>
                    <s>{item.title}</s>
                    <span className="delta-kind">{deltaKindLabel(item.kind)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {added.length > 0 && (
            <div>
              <h4>New in this analysis</h4>
              <ul className="analysis-delta-list">
                {added.slice(0, limit).map((item) => (
                  <li key={`${item.kind}:${item.title}`} className="added">
                    <Badge tone="queue">new</Badge>
                    <button type="button" className="text-button delta-jump" onClick={() => jumpTo(item)} title={`Open ${deltaKindLabel(item.kind)} section`}>
                      <strong>{item.title}</strong>
                    </button>
                    <Badge tone={item.severity === "high" ? "danger" : item.severity === "medium" ? "queue" : item.severity === "low" ? "improvement" : "neutral"}>{item.severity}</Badge>
                    <span className="delta-kind">{deltaKindLabel(item.kind)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {hidden > 0 && !showAll && (
        <button type="button" className="text-button more-toggle" onClick={() => setShowAll(true)}>
          +{hidden} more
        </button>
      )}
      <p className="analysis-delta-persisting">
        {delta.persisting.length === 0
          ? "Nothing persists from the previous analysis."
          : `${delta.persisting.length} finding${delta.persisting.length === 1 ? "" : "s"} persist${delta.persisting.length === 1 ? "s" : ""} from the previous analysis${judged > 0 ? `, ${judged} already judged by you` : ""}.`}
        {severityChanged.length > 0 && (
          <>
            {" "}
            Severity changed for {severityChanged.map((item) => `${item.title} (${item.previousSeverity} → ${item.severity})`).join(", ")}.
          </>
        )}
      </p>
    </section>
  );
}
