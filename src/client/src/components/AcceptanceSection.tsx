import { ClipboardCheck } from "lucide-react";
import type { AcceptanceContract, AcceptanceCriterion, CriterionStatus } from "../../../shared/types";
import { Badge } from "./uiBits";
import "./acceptance.css";

const statusLabel: Record<CriterionStatus, string> = { proven: "proven", unproven: "unproven", failed: "failed", "not-applicable": "n/a" };
const statusTone: Record<CriterionStatus, string> = { proven: "added", unproven: "review-needed", failed: "danger", "not-applicable": "neutral" };

export function effectiveCriterionStatus(criterion: Pick<AcceptanceCriterion, "status" | "humanStatus">): CriterionStatus {
  return criterion.humanStatus ?? criterion.status;
}

export function acceptanceTotals(contract?: AcceptanceContract | null) {
  const totals = { total: 0, proven: 0, unproven: 0, failed: 0, notApplicable: 0 };
  for (const criterion of contract?.criteria ?? []) {
    totals.total += 1;
    const status = effectiveCriterionStatus(criterion);
    if (status === "proven") totals.proven += 1;
    else if (status === "failed") totals.failed += 1;
    else if (status === "not-applicable") totals.notApplicable += 1;
    else totals.unproven += 1;
  }
  return totals;
}

/**
 * The acceptance-criteria contract: what was asked (issue/PR body), whether the
 * PR proves it, and the evidence. Reviewers can override any verdict.
 */
export function AcceptanceSection({
  contract,
  diffHash,
  busy,
  error,
  onGenerate,
  onOverride
}: {
  contract?: AcceptanceContract | null;
  diffHash?: string;
  busy: boolean;
  error?: string;
  onGenerate: (force: boolean) => void;
  onOverride: (criterion: AcceptanceCriterion, status: CriterionStatus | null) => void;
}) {
  const totals = acceptanceTotals(contract);
  const stale = Boolean(contract && diffHash && contract.diffHash !== diffHash);
  const scoreable = totals.total - totals.notApplicable;
  return (
    <section className={`summary-card acceptance-card ${totals.failed > 0 ? "has-failed" : totals.unproven > 0 ? "has-unproven" : contract ? "all-proven" : ""}`}>
      <div className="panel-title">
        <div>
          <h3>Acceptance Contract</h3>
          <p className="muted">Does the PR do what the issue and description asked, and what proves it?</p>
        </div>
        <ClipboardCheck size={18} />
      </div>

      {!contract ? (
        <>
          <p className="muted">No contract yet. The agent extracts criteria from linked issues and the PR body, then maps each one to a test, code location, CI check or local verification run.</p>
          <button type="button" onClick={() => onGenerate(false)} disabled={busy}>
            {busy ? "Building contract..." : "Build acceptance contract"}
          </button>
        </>
      ) : (
        <>
          <div className="acceptance-score">
            <strong>
              {totals.proven}/{scoreable} proven
            </strong>
            {totals.failed > 0 && <Badge tone="danger">{totals.failed} failed</Badge>}
            {totals.unproven > 0 && <Badge tone="review-needed">{totals.unproven} unproven</Badge>}
            {totals.notApplicable > 0 && <Badge tone="neutral">{totals.notApplicable} n/a</Badge>}
            <span className="muted">
              {contract.agent === "claude" ? "Claude" : "Codex"} ({contract.model}){typeof contract.costUsd === "number" ? ` · ~$${contract.costUsd.toFixed(3)}` : ""}
            </span>
            <button type="button" className="ghost" onClick={() => onGenerate(true)} disabled={busy} title="Regenerate from the current diff; your overrides are kept for unchanged criteria">
              {busy ? "Rebuilding..." : stale ? "Diff changed — rebuild" : "Rebuild"}
            </button>
          </div>
          {stale && <p className="acceptance-stale">The diff changed since this contract was built. Statuses may be outdated.</p>}
          {contract.summary && <p>{contract.summary}</p>}
          <ol className="acceptance-list">
            {contract.criteria.map((criterion) => {
              const status = effectiveCriterionStatus(criterion);
              return (
                <li key={criterion.id} className={`acceptance-item ${status}`}>
                  <div className="acceptance-item-head">
                    <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>
                    <span className="acceptance-text">{criterion.text}</span>
                    <span className="acceptance-origin muted">
                      {criterion.source === "linked-issue" ? criterion.origin ?? "issue" : criterion.source === "pr-body" ? "PR body" : "derived from diff"}
                      {criterion.humanStatus && " · reviewer verdict"}
                    </span>
                  </div>
                  {criterion.evidence.length > 0 && (
                    <ul className="acceptance-evidence">
                      {criterion.evidence.map((item, index) => (
                        <li key={index}>
                          <Badge tone="neutral">{item.kind}</Badge> <code>{item.ref}</code>
                          {item.note ? <span className="muted"> — {item.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {(criterion.note || criterion.humanNote) && <p className="muted acceptance-note">{criterion.humanNote ?? criterion.note}</p>}
                  <div className="acceptance-actions">
                    {(["proven", "unproven", "failed", "not-applicable"] as CriterionStatus[]).map((candidate) => (
                      <button
                        key={candidate}
                        type="button"
                        className={`text-button ${status === candidate ? "active" : ""}`}
                        onClick={() => onOverride(criterion, criterion.humanStatus === candidate ? null : candidate)}
                        title={criterion.humanStatus === candidate ? "Remove your override" : `Mark as ${statusLabel[candidate]}`}
                      >
                        {statusLabel[candidate]}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
          {contract.limitations.length > 0 && (
            <details>
              <summary>Could not be verified locally ({contract.limitations.length})</summary>
              <ul>
                {contract.limitations.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {error && <p className="acceptance-error">{error}</p>}
    </section>
  );
}
