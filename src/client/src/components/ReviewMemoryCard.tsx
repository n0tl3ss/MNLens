import { Brain } from "lucide-react";
import type { ReviewMemorySummary } from "../../../shared/types";
import { Badge } from "./uiBits";
import "./acceptance.css";

/**
 * What this repository's reviewers have taught MNLens: which finding patterns
 * get kept or dismissed, and one-click promotion of a pattern into a repo rule
 * (which both calibrates future analyses and documents the team's stance).
 */
export function ReviewMemoryCard({
  memory,
  onAddRepoRule
}: {
  memory?: ReviewMemorySummary;
  onAddRepoRule: (rule: { title: string; body: string; tone?: string; source?: string }) => void;
}) {
  if (!memory || memory.total === 0) {
    return (
      <section className="summary-card review-memory-card">
        <div className="panel-title">
          <h3>Review Memory</h3>
          <Brain size={18} />
        </div>
        <p className="muted">Use 👍 / 👎 on findings to teach MNLens what matters in this repository. Verdicts calibrate future Deep Analyze runs and surface here as patterns you can turn into repo rules.</p>
      </section>
    );
  }
  const actionable = memory.patterns.filter((pattern) => pattern.suggestedRule);
  return (
    <section className="summary-card review-memory-card">
      <div className="panel-title">
        <div>
          <h3>Review Memory</h3>
          <p className="muted">
            {memory.total} verdicts in {memory.repository}{memory.shared ? ` from ${memory.members} reviewer${memory.members === 1 ? "" : "s"} (team folder)` : ""}: {memory.kept} kept, {memory.dismissed} dismissed. Future analyses are calibrated with these.
          </p>
        </div>
        <Brain size={18} />
      </div>
      {actionable.length === 0 ? (
        <p className="muted">No strong patterns yet; keep rating findings.</p>
      ) : (
        actionable.slice(0, 6).map((pattern) => (
          <div key={pattern.key} className="review-memory-pattern">
            <div>
              <strong>{pattern.examples[0]}</strong>
              <em className="muted">
                <Badge tone={pattern.dismissed > pattern.kept ? "danger" : "added"}>{pattern.dismissed > pattern.kept ? `dismissed ${pattern.dismissed}x` : `kept ${pattern.kept}x`}</Badge> {pattern.suggestedRule}
              </em>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                onAddRepoRule({
                  title: pattern.dismissed > pattern.kept ? `Skip: ${pattern.examples[0].slice(0, 60)}` : `Always check: ${pattern.examples[0].slice(0, 60)}`,
                  body: pattern.suggestedRule ?? "",
                  tone: pattern.dismissed > pattern.kept ? "info" : "danger",
                  source: "review-memory"
                })
              }
            >
              Add as repo rule
            </button>
          </div>
        ))
      )}
    </section>
  );
}
