import { GitPullRequest, Loader2, RefreshCw, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import type { AnalysisResult, Job, PrDetail, PrListItem } from "../../../shared/types";
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
  onAnalyze,
  onClearCache,
  onImprovePr,
  onReanalyze,
  onRebaseDefault,
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
  onAnalyze: () => void;
  onClearCache: () => void;
  onImprovePr: () => void;
  onReanalyze: () => void;
  onRebaseDefault: () => void;
  onToggleAttention: () => void;
}) {
  const needsDeepAnalysis = !analysis && job?.mode !== "deep";
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
              <span>
                target{" "}
                <a className="branch-link" href={`${detail.url.split("/pull/")[0]}/tree/${encodeURIComponent(detail.baseRefName)}`} target="_blank" rel="noreferrer">
                  {detail.baseRefName}
                </a>
              </span>
            )}
          </div>
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
            <button disabled={rebasing} onClick={onRebaseDefault} title="Rebase this PR onto the repository default branch. If conflicts happen, Codex will try to resolve them in the app workspace before pushing.">
              {rebasing ? <Loader2 size={16} className="spin" /> : <GitPullRequest size={16} />}
              {rebasing ? "Rebasing" : "Rebase default"}
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
      </div>
    </>
  );
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
