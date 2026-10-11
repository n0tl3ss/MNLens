import { Scale } from "lucide-react";
import type { AnalysisResult } from "../../../shared/types";
import { Badge } from "./uiBits";
import "./secondOpinion.css";

const agentName = (agent: "codex" | "claude" | undefined) => (agent === "claude" ? "Claude" : "Codex");

/**
 * Cross-agent audit of the deep analysis. Disagreements are surfaced first because
 * they are where a human reviewer's time is best spent.
 */
export function SecondOpinionSection({
  analysis,
  diffHash,
  busy,
  error,
  onRequest
}: {
  analysis?: AnalysisResult;
  diffHash?: string;
  busy: boolean;
  error?: string;
  onRequest: () => void;
}) {
  if (!analysis) return null;
  const opinion = analysis.secondOpinion;
  const stale = Boolean(opinion && diffHash && opinion.diffHash !== diffHash);
  const other = analysis.agent === "claude" ? "Codex" : "Claude";
  return (
    <section className="summary-card second-opinion">
      <div className="panel-title">
        <h3>Second Opinion</h3>
        <Scale size={18} />
      </div>
      {!opinion || stale ? (
        <>
          <p className="muted">
            Ask {other} (economy tier) to audit {agentName(analysis.agent)}'s findings against the diff. Two vendors rarely hallucinate the same risk; disagreements point to what deserves your attention.
            {stale ? " The previous opinion was for an older diff." : ""}
          </p>
          <button type="button" onClick={onRequest} disabled={busy}>
            {busy ? "Auditing..." : `Get ${other} second opinion`}
          </button>
          {error && <p className="second-opinion-error">{error}</p>}
        </>
      ) : (
        <>
          <p className="second-opinion-head">
            <Badge tone={opinion.verdict === "agree" ? "added" : opinion.verdict === "disagree" ? "danger" : "review-needed"}>{opinion.verdict.replace("-", " ")}</Badge>
            <span className="muted">
              {agentName(opinion.agent)} ({opinion.model}) · confidence {Math.round(opinion.confidence * 100)}%{typeof opinion.costUsd === "number" ? ` · ~$${opinion.costUsd.toFixed(3)}` : ""}
            </span>
          </p>
          {opinion.summary && <p>{opinion.summary}</p>}
          {opinion.disputed.length > 0 && (
            <div className="second-opinion-group">
              <strong>Disputed ({opinion.disputed.length})</strong>
              <ul>
                {opinion.disputed.map((item, index) => (
                  <li key={index}>
                    <Badge tone={item.severity === "high" ? "danger" : "review-needed"}>{item.severity}</Badge> <em>{item.item}</em> — {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {opinion.missed.length > 0 && (
            <div className="second-opinion-group">
              <strong>Missed by the first analysis ({opinion.missed.length})</strong>
              <ul>
                {opinion.missed.map((item, index) => (
                  <li key={index}>
                    <Badge tone={item.severity === "high" ? "danger" : "review-needed"}>{item.severity}</Badge> <em>{item.title}</em> — {item.observation}
                    {item.recommendation ? ` Recommendation: ${item.recommendation}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {opinion.draftCommentIssues.length > 0 && (
            <div className="second-opinion-group">
              <strong>Draft comment issues</strong>
              <ul>
                {opinion.draftCommentIssues.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {opinion.agreements.length > 0 && (
            <details>
              <summary>Agreed on {opinion.agreements.length} item{opinion.agreements.length === 1 ? "" : "s"}</summary>
              <ul>
                {opinion.agreements.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </details>
          )}
          <button type="button" className="ghost" onClick={onRequest} disabled={busy}>
            {busy ? "Auditing..." : "Re-run second opinion"}
          </button>
          {error && <p className="second-opinion-error">{error}</p>}
        </>
      )}
    </section>
  );
}
