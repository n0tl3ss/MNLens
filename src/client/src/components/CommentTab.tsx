import { Clipboard, Loader2, MessageSquare, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AnalysisResult, FixJob, PrDetail, ReviewComment, ReviewInsight, ReviewProgress, VerificationJob } from "../../../shared/types";
import { AuthorLink, Badge } from "./uiBits";

export type DraftReviewComment = ReviewComment & { id: string };

export function CommentTab({
  detail,
  analysis,
  progress,
  reviewComments,
  verificationJobs,
  fixJobs,
  canApproveWithoutComments,
  openConversationReplies,
  conversationReplyDrafts,
  postingConversationReply,
  onToggleConversationReply,
  onUpdateConversationReplyDraft,
  onCancelConversationReply,
  onSubmitConversationReply
}: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  progress?: ReviewProgress;
  reviewComments: DraftReviewComment[];
  verificationJobs: VerificationJob[];
  fixJobs: FixJob[];
  canApproveWithoutComments: boolean;
  openConversationReplies: Record<number, boolean>;
  conversationReplyDrafts: Record<number, string>;
  postingConversationReply: Record<number, boolean>;
  onToggleConversationReply: (commentId: number) => void;
  onUpdateConversationReplyDraft: (commentId: number, body: string) => void;
  onCancelConversationReply: (commentId: number) => void;
  onSubmitConversationReply: (commentId: number) => void;
}) {
  const generatedComment = buildFinalReviewComment(detail, analysis, progress, reviewComments, verificationJobs, fixJobs, canApproveWithoutComments);
  const text = generatedComment || analysis?.draftComment || "Analyze this PR to generate a draft review comment.";
  return (
    <div className="panel grid-two">
      <ReviewCommentBuilderSection
        detail={detail}
        analysis={analysis}
        progress={progress}
        reviewComments={reviewComments}
        verificationJobs={verificationJobs}
        fixJobs={fixJobs}
        canApproveWithoutComments={canApproveWithoutComments}
      />
      <section className="summary-card review-summary-card">
        <h3>Conversation</h3>
        {detail.conversationComments.length === 0 ? (
          <p className="muted">No conversation comments yet.</p>
        ) : (
          <div className="conversation-list">
            {detail.conversationComments.map((comment) => (
              <article className="conversation-comment" key={comment.id}>
                <div className="conversation-comment-meta">
                  <AuthorLink name={comment.author} url={comment.authorUrl} />
                  <span>{relativeDate(comment.createdAt)}</span>
                </div>
                <MarkdownBody body={comment.body} />
                <div className="conversation-comment-actions">
                  <a href={comment.url} target="_blank" rel="noreferrer">
                    Open comment
                  </a>
                  <button className="text-button" onClick={() => onToggleConversationReply(comment.id)}>
                    <MessageSquare size={14} />
                    Add comment
                  </button>
                </div>
                {(openConversationReplies[comment.id] || (conversationReplyDrafts[comment.id] ?? "").length > 0) && (
                  <div className="conversation-reply-form">
                    <label htmlFor={`conversation-reply-${comment.id}`}>Add PR conversation comment</label>
                    <textarea
                      id={`conversation-reply-${comment.id}`}
                      value={conversationReplyDrafts[comment.id] ?? ""}
                      onChange={(event) => onUpdateConversationReplyDraft(comment.id, event.target.value)}
                      placeholder={`Add a PR conversation comment referencing ${comment.author}...`}
                    />
                    <div className="conversation-reply-actions">
                      <button className="secondary" disabled={postingConversationReply[comment.id]} onClick={() => onCancelConversationReply(comment.id)}>
                        Cancel
                      </button>
                      <button
                        disabled={postingConversationReply[comment.id] || !(conversationReplyDrafts[comment.id] ?? "").trim()}
                        onClick={() => onSubmitConversationReply(comment.id)}
                      >
                        {postingConversationReply[comment.id] ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                        Post comment
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="summary-card overview-summary-card">
        <div className="panel-title">
          <div>
            <h3>Draft Comment</h3>
            <p className="muted">Generated from unchecked risks, local drafts, verification state, and the current review plan.</p>
          </div>
          <button onClick={() => void navigator.clipboard.writeText(text)}>
            <Clipboard size={16} />
            Copy
          </button>
        </div>
        <textarea value={text} readOnly />
      </section>
    </div>
  );
}

function ReviewCommentBuilderSection({
  detail,
  analysis,
  progress,
  reviewComments,
  verificationJobs,
  fixJobs,
  canApproveWithoutComments
}: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  progress?: ReviewProgress;
  reviewComments: DraftReviewComment[];
  verificationJobs: VerificationJob[];
  fixJobs: FixJob[];
  canApproveWithoutComments: boolean;
}) {
  const guidance = reviewCommentGuidance(detail, analysis, progress, reviewComments, verificationJobs, fixJobs, canApproveWithoutComments);
  return (
    <section className="summary-card review-comment-builder">
      <div className="panel-title">
        <div>
          <h3>Review Composer</h3>
          <p className="muted">Use this to decide whether the final GitHub review should approve, request changes, or ask questions.</p>
        </div>
        <Badge tone={guidance.ready ? "added" : guidance.blocking.length > 0 ? "danger" : "queue"}>
          {guidance.ready ? "approval-ready" : guidance.blocking.length > 0 ? "needs changes" : "questions"}
        </Badge>
      </div>
      <div className="comment-guidance-grid">
        <div>
          <strong>Blocking</strong>
          {guidance.blocking.length === 0 ? <p className="muted">No blocking items detected.</p> : <ul>{guidance.blocking.map((item) => <li key={item}>{item}</li>)}</ul>}
        </div>
        <div>
          <strong>Questions / non-blocking</strong>
          {guidance.questions.length === 0 ? <p className="muted">No open questions detected.</p> : <ul>{guidance.questions.map((item) => <li key={item}>{item}</li>)}</ul>}
        </div>
        <div>
          <strong>Evidence to mention</strong>
          {guidance.evidence.length === 0 ? <p className="muted">No local evidence recorded yet.</p> : <ul>{guidance.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
        </div>
      </div>
    </section>
  );
}

function buildFinalReviewComment(
  detail: PrDetail,
  analysis: AnalysisResult | undefined,
  progress: ReviewProgress | undefined,
  reviewComments: DraftReviewComment[],
  verificationJobs: VerificationJob[],
  fixJobs: FixJob[],
  canApproveWithoutComments: boolean
): string {
  if (!analysis) return "";
  const checked = new Set(progress?.checkedItems ?? []);
  const openRisks = sortReviewInsights(analysis.riskDetails ?? [])
    .filter((risk, index) => !checked.has(insightProgressId("Risks", risk, index)))
    .slice(0, 3);
  const failedChecks = verificationJobs.filter((job) => job.status === "failed").slice(0, 2);
  const passedChecks = verificationJobs.filter((job) => job.status === "done").slice(0, 3);
  const drafts = reviewComments.filter((comment) => comment.body.trim());
  const latestFix = [...fixJobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const lines: string[] = [];
  if (canApproveWithoutComments && openRisks.length === 0 && failedChecks.length === 0 && drafts.length === 0) {
    lines.push("Looks good from my review.");
    lines.push("");
    lines.push(`I checked the intended change: ${analysis.summary}`);
  } else {
    lines.push("I have a few review points before this is ready:");
  }
  if (openRisks.length > 0) {
    lines.push("");
    lines.push("Blocking / needs attention:");
    for (const risk of openRisks) lines.push(`- ${risk.title}: ${risk.recommendation || risk.perspective || risk.observation}`);
  }
  if (drafts.length > 0) {
    lines.push("");
    lines.push("Line comments:");
    for (const comment of drafts.slice(0, 5)) lines.push(`- ${comment.path}:${comment.line} - ${compactText(comment.body, 180)}`);
  }
  if (failedChecks.length > 0) {
    lines.push("");
    lines.push("Verification still failing:");
    for (const job of failedChecks) lines.push(`- ${job.command}: ${job.error || job.statusMessage || "failed"}`);
  }
  if (passedChecks.length > 0) {
    lines.push("");
    lines.push("Checked locally:");
    for (const job of passedChecks) lines.push(`- ${job.command}`);
  }
  if (latestFix?.diff?.trim() && !latestFix.pushed) {
    lines.push("");
    lines.push("There is a prepared Codex fix preview that still needs human inspection before push.");
  }
  if (detail.linkedIssues.length > 0) {
    lines.push("");
    lines.push(`Context checked against linked issue: ${detail.linkedIssues.map((issue) => `#${issue.number}`).join(", ")}.`);
  }
  return lines.join("\n");
}

function reviewCommentGuidance(
  detail: PrDetail,
  analysis: AnalysisResult | undefined,
  progress: ReviewProgress | undefined,
  reviewComments: DraftReviewComment[],
  verificationJobs: VerificationJob[],
  fixJobs: FixJob[],
  canApproveWithoutComments: boolean
): { ready: boolean; blocking: string[]; questions: string[]; evidence: string[] } {
  const checked = new Set(progress?.checkedItems ?? []);
  const blocking = sortReviewInsights(analysis?.riskDetails ?? [])
    .filter((risk, index) => risk.severity === "high" && !checked.has(insightProgressId("Risks", risk, index)))
    .map((risk) => `${risk.title}: ${risk.recommendation || risk.perspective || risk.observation}`)
    .slice(0, 4);
  for (const job of verificationJobs.filter((job) => job.status === "failed").slice(0, 3)) {
    blocking.push(`${job.command} failed${job.error ? `: ${compactText(job.error, 160)}` : ""}`);
  }
  const latestFix = [...fixJobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (latestFix?.diff?.trim() && !latestFix.pushed) blocking.push("Prepared Codex changes need inspection before final review.");

  const questions = [
    ...sortReviewInsights(analysis?.reviewerFocusDetails ?? [])
      .filter((item, index) => !checked.has(insightProgressId("Reviewer Focus", item, index)))
      .map((item) => `${item.title}: ${item.recommendation || item.perspective || item.observation}`)
      .slice(0, 3),
    ...reviewComments.filter((comment) => comment.body.trim()).slice(0, 3).map((comment) => `${comment.path}:${comment.line} - ${compactText(comment.body, 140)}`)
  ];

  const evidence = [
    ...verificationJobs.filter((job) => job.status === "done").slice(0, 3).map((job) => `${job.command} passed`),
    ...(analysis?.evidenceDetails ?? []).slice(0, 2).map((item) => item.title || item.observation),
    detail.linkedIssues.length > 0 ? `Checked linked issue context: ${detail.linkedIssues.map((issue) => `#${issue.number}`).join(", ")}` : ""
  ].filter(Boolean);

  return {
    ready: canApproveWithoutComments && blocking.length === 0 && reviewComments.every((comment) => !comment.body.trim()),
    blocking,
    questions,
    evidence
  };
}

function sortReviewInsights(items: ReviewInsight[]): ReviewInsight[] {
  const order: Record<ReviewInsight["severity"], number> = { high: 0, medium: 1, low: 2, info: 3 };
  return [...items].sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title));
}

function insightProgressId(section: string, item: Partial<ReviewInsight> & { observation: string }, index: number): string {
  const source = `${section}:${item.title ?? ""}:${item.observation}:${index}`;
  let hash = 0;
  for (const char of source) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `insight:${section}:${index}:${hash.toString(16)}`;
}

function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}

function relativeDate(value: string): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (!Number.isFinite(minutes)) return value;
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 48 * 60) return "yesterday";
  return date.toLocaleDateString();
}

function compactText(value: string, limit = 140): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text || "No body.";
}
