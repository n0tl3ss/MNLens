import { Check, GitBranch, Loader2, RefreshCw, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
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
            <button className={attentionMode ? "active" : ""} onClick={onToggleAttention} title="Show only the highest-value review work.">
              <ShieldAlert size={16} />
              {attentionMode ? "Attention: On" : "Attention mode"}
            </button>
            <button
              className={needsDeepAnalysis ? "deep-analyze-suggested" : ""}
              onClick={onAnalyze}
              title={needsDeepAnalysis ? "Run full Codex review guidance for this PR. Fast scores are only queue estimates." : "Run full Codex review guidance for this PR."}
            >
              <Sparkles size={16} />
              {needsDeepAnalysis ? "Deep Analyze recommended" : "Deep Analyze"}
            </button>
            <button onClick={onReanalyze}>
              <RefreshCw size={16} />
              Deep Reanalyze
            </button>
            <button
              className={needsBranchWork ? "branch-work-suggested" : ""}
              disabled={rebasing}
              onClick={onUpdateBranch}
              title="Prepare a branch update preview. MNLens chooses rebase for small PRs and merge for large or conflict-heavy PRs. Nothing is pushed until you approve."
            >
              {rebasing ? <Loader2 size={16} className="spin" /> : <GitBranch size={16} />}
              {rebasing ? "Preparing update" : needsBranchWork ? "Update branch" : "Update branch"}
            </button>
            {isOwnedByCurrentUser && (
              <button
                disabled={selectedFixRunning}
                onClick={onImprovePr}
                title="Ask Codex to address actionable review comments, failing checks, test gaps, and score blockers. It prepares code only; it does not commit or push."
              >
                {selectedFixRunning ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                Improve PR
              </button>
            )}
            <button className="icon-button danger" onClick={onClearCache} title="Clear cache">
              <Trash2 size={16} />
            </button>
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
