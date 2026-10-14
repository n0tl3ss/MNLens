import { ClipboardCheck, Loader2, Play } from "lucide-react";
import type { AcceptanceContract, AcceptanceCriterion, CriterionStatus, VerificationJob } from "../../../shared/types";
import { acceptanceTotals, criterionRunJob, criterionRunState, effectiveCriterionStatus } from "../../../shared/acceptance";
import { Badge } from "./uiBits";
import "./acceptance.css";

export { acceptanceTotals, effectiveCriterionStatus };

const statusLabel: Record<CriterionStatus, string> = { proven: "proven", unproven: "unproven", failed: "failed", "not-applicable": "n/a" };
const statusTone: Record<CriterionStatus, string> = { proven: "added", unproven: "review-needed", failed: "danger", "not-applicable": "neutral" };

/**
 * The acceptance-criteria contract: what was asked (issue/PR body), whether the
 * PR proves it, and the evidence. "Proven" means a test encodes the criterion
 * and MNLens ran it green; a failed run turns the criterion red. Reviewers can
 * override any verdict.
 */
export function AcceptanceSection({
  contract,
  diffHash,
  busy,
  error,
  verificationJobs = [],
  onGenerate,
  onOverride,
  onRunVerification
}: {
  contract?: AcceptanceContract | null;
  diffHash?: string;
  busy: boolean;
  error?: string;
  verificationJobs?: VerificationJob[];
  onGenerate: (force: boolean) => void;
  onOverride: (criterion: AcceptanceCriterion, status: CriterionStatus | null) => void;
  /** Runs (or re-runs) the command that exercises a criterion. */
  onRunVerification?: (command: string) => void;
}) {
  const totals = acceptanceTotals(contract, verificationJobs);
  const stale = Boolean(contract && diffHash && contract.diffHash !== diffHash);
  const scoreable = totals.total - totals.notApplicable;
  return (
    <section className={`summary-card acceptance-card ${totals.failed > 0 ? "has-failed" : totals.unproven > 0 ? "has-unproven" : contract ? "all-proven" : ""}`}>
      <div className="panel-title">
        <div>
          <h3>Acceptance Contract</h3>
          <p className="muted">Does the PR do what the issue and description asked, and what proves it? Named tests are run locally; a red run fails the criterion.</p>
        </div>
        <ClipboardCheck size={18} />
      </div>

      {!contract ? (
        <>
          <p className="muted">Built automatically after Deep Analyze. The agent extracts criteria from linked issues and the PR body, maps each one to a test, code location, CI check or local run, and MNLens runs the named tests.</p>
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
            {totals.ran > 0 && <Badge tone="added">{totals.ran} ran green</Badge>}
            {totals.running > 0 && <Badge tone="queue">{totals.running} running</Badge>}
            {totals.failed > 0 && <Badge tone="danger">{totals.failed} failed</Badge>}
            {totals.blocked > 0 && <Badge tone="neutral">{totals.blocked} could not run</Badge>}
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
              const status = effectiveCriterionStatus(criterion, verificationJobs);
              const run = criterionRunState(criterion, verificationJobs);
              const job = criterionRunJob(criterion, verificationJobs);
              return (
                <li key={criterion.id} className={`acceptance-item ${status}`}>
                  <div className="acceptance-item-head">
                    <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>
                    {run && <RunBadge state={run} />}
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
                  {criterion.command && (
                    <div className="acceptance-command">
                      <code>{criterion.command}</code>
                      {onRunVerification && (
                        <button type="button" className="ghost" onClick={() => onRunVerification(criterion.command!)} disabled={run === "queued" || run === "running"} title={run ? "Run this command again in the PR checkout" : "Run this command in the PR checkout"}>
                          {run === "queued" || run === "running" ? <Loader2 size={13} className="spin" /> : <Play size={13} />} {run ? "Run again" : "Run"}
                        </button>
                      )}
                      {job?.error && run === "failed" && <span className="muted acceptance-run-error">{job.error.split("\n")[0].slice(0, 140)}</span>}
                    </div>
                  )}
                  {run === "blocked" && (
                    <p className="muted acceptance-note">
                      Could not run here{job?.blockedReason ? `: ${job.blockedReason}` : ""}. The agent's verdict stands; fix the environment and run again.
                    </p>
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

function RunBadge({ state }: { state: NonNullable<ReturnType<typeof criterionRunState>> }) {
  if (state === "passed") return <Badge tone="added">ran green</Badge>;
  if (state === "failed") return <Badge tone="danger">run failed</Badge>;
  if (state === "blocked") return <Badge tone="neutral">could not run</Badge>;
  return (
    <Badge tone="queue">
      <Loader2 size={11} className="spin" /> {state === "queued" ? "queued" : "running"}
    </Badge>
  );
}
