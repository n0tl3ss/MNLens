import { Clipboard, Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { AnalysisResult, FixJob, PrDetail, VerificationJob } from "../../../shared/types";
import type { DraftReviewComment } from "./CommentTab";
import type { ReviewReplay } from "./ReviewDeltaSection";
import type { ReviewRecommendation } from "./OverviewSections";
import { ReviewTraceSection } from "./ReviewTraceSection";
import "./overviewTab.css";

export function HandoffTab({
  detail,
  analysis,
  reviewComments,
  verificationJobs,
  fixJobs,
  recommendation,
  replay,
  markdown,
  feedbackPreview,
  feedbackBusy,
  feedbackError,
  onPreviewFeedback,
  onPostFeedback
}: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  reviewComments: DraftReviewComment[];
  verificationJobs: VerificationJob[];
  fixJobs: FixJob[];
  recommendation: ReviewRecommendation;
  replay: ReviewReplay;
  markdown: string;
  feedbackPreview?: string;
  feedbackBusy?: boolean;
  feedbackError?: string;
  onPreviewFeedback?: (note: string) => void;
  onPostFeedback?: (body: string) => void;
}) {
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState(feedbackPreview ?? "");
  useEffect(() => setDraft(feedbackPreview ?? ""), [feedbackPreview]);
  return (
    <div className="panel handoff-panel">
      <ReviewTraceSection
        detail={detail}
        analysis={analysis}
        reviewComments={reviewComments}
        verificationJobs={verificationJobs}
        fixJobs={fixJobs}
      />
      <section className={`summary-card handoff-card ${recommendation.tone}`}>
        <div className="panel-title">
          <div>
            <h3>Review Handoff</h3>
            <p className="muted">Copy this when pausing, switching reviewers, or handing the PR back to the author.</p>
          </div>
          <button onClick={() => void navigator.clipboard.writeText(markdown)}>
            <Clipboard size={16} />
            Copy handoff
          </button>
        </div>
        <div className="handoff-highlights">
          <article>
            <span>Recommendation</span>
            <strong>{recommendation.label}</strong>
            <p>{recommendation.summary}</p>
          </article>
          <article>
            <span>Score</span>
            <strong>{recommendation.score.score}/100</strong>
            <p>{recommendation.score.label}, {recommendation.score.effort.label} review.</p>
          </article>
          <article>
            <span>Replay</span>
            <strong>{replay.label}</strong>
            <p>{replay.summary}</p>
          </article>
        </div>
        <textarea className="handoff-text" value={markdown} readOnly />
      </section>
      {onPreviewFeedback && onPostFeedback && (
        <section className="summary-card handoff-card">
          <div className="panel-title">
            <div>
              <h3>Feedback To Author</h3>
              <p className="muted">
                One structured comment for the PR author: acceptance-criteria status with evidence, the findings you kept (👍), second-opinion notes, and your local verification runs. Nothing is posted until you click Post.
              </p>
            </div>
          </div>
          <label className="handoff-note">
            <span>Optional note to the author</span>
            <input type="text" value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Approving once the retry test lands." />
          </label>
          <div className="inline-actions">
            <button type="button" onClick={() => onPreviewFeedback(note)} disabled={feedbackBusy}>
              {feedbackBusy && !draft ? "Building..." : draft ? "Rebuild preview" : "Build comment preview"}
            </button>
            {draft && (
              <>
                <button type="button" onClick={() => void navigator.clipboard.writeText(draft)}>
                  <Clipboard size={16} />
                  Copy
                </button>
                <button type="button" className="primary" onClick={() => onPostFeedback(draft)} disabled={feedbackBusy || !draft.trim()} title="Posts this comment to the PR conversation with your GitHub identity">
                  <Send size={16} />
                  {feedbackBusy ? "Posting..." : "Post to PR"}
                </button>
              </>
            )}
          </div>
          {draft && <textarea className="handoff-text" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />}
          {feedbackError && <p className="acceptance-error">{feedbackError}</p>}
        </section>
      )}
    </div>
  );
}
