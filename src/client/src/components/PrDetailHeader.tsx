import { Check, GitBranch, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { ActionMenu } from "./ActionMenu";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AnalysisResult, Job, PrDetail, PrListItem, RepositoryBranch } from "../../../shared/types";
import type { ReviewReadiness, ReviewScore } from "../reviewScoring";
import { PrScoreCard } from "./ReviewStatusCards";
import { AuthorLink, Badge, plural, relativeDate } from "./uiBits";
import "./prDetailHeader.css";

export function PrDetailHeader({
  analysis,
  attentionMode,
  detail,
  isOwnedByCurrentUser,
  job,
  pr,
  readiness,
  rebasing,
  reviewScore,
  selectedFixRunning,
  targetBranches,
  targetChanging,
  onAnalyze,
  onChangeTargetBranch,
  onClearCache,
  onImprovePr,
  onReanalyze,
  onUpdateBranch,
  onToggleAttention
}: {
  analysis?: AnalysisResult;
  attentionMode: boolean;
  detail?: PrDetail;
  isOwnedByCurrentUser: boolean;
  job?: Job;
  pr: PrListItem;
  readiness?: ReviewReadiness;
  rebasing: boolean;
  reviewScore?: ReviewScore;
  selectedFixRunning: boolean;
  targetBranches: RepositoryBranch[];
  targetChanging: boolean;
  onAnalyze: () => void;
  onChangeTargetBranch: (baseRefName: string) => void;
  onClearCache: () => void;
  onImprovePr: () => void;
  onReanalyze: () => void;
  onUpdateBranch: () => void;
  onToggleAttention: () => void;
}) {
  const needsDeepAnalysis = !analysis && job?.mode !== "deep";
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetValue, setTargetValue] = useState(detail?.baseRefName ?? "");
  const needsBranchWork = needsRebaseOrConflictResolution(detail);
  const selectedTargetExists = targetBranches.some((branch) => branch.name === targetValue.trim());

  useEffect(() => {
    setTargetValue(detail?.baseRefName ?? "");
    setEditingTarget(false);
  }, [detail?.key, detail?.baseRefName]);

  function submitTargetBranch(event: FormEvent) {
    event.preventDefault();
    const next = targetValue.trim();
    if (!next || next === detail?.baseRefName) {
      setEditingTarget(false);
      return;
    }
    const confirmed = window.confirm(`Change PR #${pr.number} target branch from ${detail?.baseRefName || "unknown"} to ${next}?`);
    if (!confirmed) return;
    onChangeTargetBranch(next);
  }

  return (
    <>
      <header className="detail-header">
        <div>
          <p className="eyebrow">{pr.repository} #{pr.number}</p>
          <h2>{pr.title}</h2>
          <div className="detail-meta">
            <span>by <AuthorLink name={pr.author} url={pr.authorUrl} /></span>
            <span>{relativeDate(pr.updatedAt)}</span>
            {detail && <span>{detail.changedFiles} files</span>}
            <span>{plural(pr.commentsCount, "comment")}</span>
            {detail && <span>{plural(detail.reviewComments.length, "line comment")}</span>}
            {detail?.baseRefName && (
              <span className="target-branch-control">
                target{" "}
                <a className="branch-link" href={`${detail.url.split("/pull/")[0]}/tree/${encodeURIComponent(detail.baseRefName)}`} target="_blank" rel="noreferrer">
                  {detail.baseRefName}
                </a>
                <button type="button" className="text-button" disabled={targetChanging} onClick={() => setEditingTarget((value) => !value)}>
                  <GitBranch size={13} />
                  Change
                </button>
              </span>
            )}
          </div>
          {editingTarget && detail?.baseRefName && (
            <form className="target-branch-editor" onSubmit={submitTargetBranch}>
              <select
                value={targetValue}
                onChange={(event) => setTargetValue(event.target.value)}
                autoFocus
              >
                {!selectedTargetExists && targetValue && <option value={targetValue}>{targetValue}</option>}
                {targetBranches.map((branch) => (
                  <option value={branch.name} key={branch.name}>
                    {branch.name}{branch.protected ? " (protected)" : ""}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={targetChanging || !targetValue.trim() || targetValue.trim() === detail.baseRefName}>
                {targetChanging ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                Save target
              </button>
              <button type="button" className="icon-button" disabled={targetChanging} onClick={() => setEditingTarget(false)} title="Cancel target branch change">
                <X size={14} />
              </button>
              {targetBranches.length === 0 && <span className="target-branch-hint">No branch list loaded; refresh PR data and try again.</span>}
            </form>
          )}
          {detail?.reviewers?.length ? (
            <div className="reviewer-status-list" aria-label="Pull request reviewers">
              <span>reviewers</span>
              {detail.reviewers.map((reviewer) => (
                <a
                  className={`reviewer-status ${reviewerTone(reviewer.status)}`}
                  href={reviewer.url}
                  target="_blank"
                  rel="noreferrer"
                  key={`${reviewer.login}-${reviewer.status}`}
                  title={reviewer.submittedAt ? `${reviewer.status.replace("_", " ")} ${new Date(reviewer.submittedAt).toLocaleString()}` : reviewer.status.replace("_", " ")}
                >
                  <strong>{reviewer.login}</strong>
                  <em>{reviewerLabel(reviewer.status)}</em>
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <div className="detail-actions">
          <div className="detail-action-buttons">
            <a className="button-like" href={pr.url} target="_blank" rel="noreferrer">
              Open PR
            </a>
            {analysis ? (
              <button onClick={onReanalyze} title="Run Deep Analyze again on the current diff and discussion.">
                <RefreshCw size={16} />
                Re-analyze
              </button>
            ) : (
              <button className={needsDeepAnalysis ? "deep-analyze-suggested" : ""} onClick={onAnalyze} title="Run the agent's full review guidance for this PR. Fast scores are only queue estimates.">
                <Sparkles size={16} />
                {needsDeepAnalysis ? "Deep Analyze — start here" : "Deep Analyze"}
              </button>
            )}
            {needsBranchWork && (
              <button className="branch-work-suggested" disabled={rebasing} onClick={onUpdateBranch} title="Prepare a branch update preview. MNLens chooses rebase for small PRs and merge for large or conflict-heavy PRs. Nothing is pushed until you approve.">
                {rebasing ? <Loader2 size={16} className="spin" /> : <GitBranch size={16} />}
                {rebasing ? "Preparing update" : "Update branch"}
              </button>
            )}
            <ActionMenu
              title="More actions"
              items={[
                { label: attentionMode ? "Attention mode: on" : "Attention mode", checked: attentionMode, onSelect: onToggleAttention, title: "Show only the highest-value review work." },
                ...(needsBranchWork ? [] : [{ label: rebasing ? "Preparing branch update..." : "Update branch", disabled: rebasing, onSelect: onUpdateBranch, title: "Prepare a rebase/merge preview; nothing is pushed until you approve." }]),
                ...(isOwnedByCurrentUser ? [{ label: selectedFixRunning ? "Improving PR..." : "Improve PR with the agent", disabled: selectedFixRunning, onSelect: onImprovePr, title: "Ask the agent to address review comments, failing checks and test gaps. It prepares code only; it does not push." }] : []),
                { label: "Clear cached data for this PR", danger: true, onSelect: onClearCache }
              ]}
            />
          </div>
          {reviewScore && <PrScoreCard score={reviewScore} />}
        </div>
      </header>

      <div className="status-strip">
        {readiness && <Badge tone={readiness.tone}>{readiness.label}</Badge>}
        {attentionMode && <Badge tone="queue">attention mode</Badge>}
        <Badge tone={toneForType(analysis?.type)}>{analysis?.type ?? pr.aiType ?? "not analyzed"}</Badge>
        {job && <Badge tone={job.status === "failed" ? "danger" : "neutral"}>{job.status}</Badge>}
        {pr.isDraft && <Badge>draft</Badge>}
        <Badge tone={toneForReviewDecision(detail?.reviewDecision)}>{reviewDecisionLabel(detail?.reviewDecision)}</Badge>
        {needsBranchWork && <Badge tone="danger">{branchWorkLabel(detail)}</Badge>}
      </div>
    </>
  );
}

function needsRebaseOrConflictResolution(detail?: PrDetail): boolean {
  return /dirty|behind/i.test(detail?.mergeStateStatus ?? "") || (detail?.branchBehindBy ?? 0) > 0;
}

function branchWorkLabel(detail?: PrDetail): string {
  if ((detail?.branchBehindBy ?? 0) > 0) return `target branch updated by ${detail?.branchBehindBy} commit${detail?.branchBehindBy === 1 ? "" : "s"}`;
  return "needs rebase/conflict check";
}

function reviewerLabel(status: string): string {
  if (status === "APPROVED") return "approved";
  if (status === "CHANGES_REQUESTED") return "changes";
  if (status === "COMMENTED") return "commented";
  if (status === "DISMISSED") return "dismissed";
  if (status === "PENDING") return "waiting";
  return "unknown";
}

function reviewerTone(status: string): string {
  if (status === "APPROVED") return "approved";
  if (status === "CHANGES_REQUESTED") return "changes";
  if (status === "PENDING") return "waiting";
  return "commented";
}

function toneForType(type?: string): string {
  if (type === "bug") return "danger";
  if (type === "feature") return "feature";
  if (type === "improvement") return "improvement";
  return "neutral";
}

function toneForReviewDecision(decision?: string): string {
  if (decision === "APPROVED") return "added";
  if (decision === "CHANGES_REQUESTED") return "danger";
  if (decision === "REVIEW_REQUIRED") return "queue";
  return "review-needed";
}

function reviewDecisionLabel(decision?: string): string {
  if (decision === "APPROVED") return "approved";
  if (decision === "CHANGES_REQUESTED") return "changes requested";
  if (decision === "REVIEW_REQUIRED") return "review required";
  return "not reviewed";
}
