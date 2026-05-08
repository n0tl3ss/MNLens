import { Clipboard } from "lucide-react";
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
  markdown
}: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  reviewComments: DraftReviewComment[];
  verificationJobs: VerificationJob[];
  fixJobs: FixJob[];
  recommendation: ReviewRecommendation;
  replay: ReviewReplay;
  markdown: string;
}) {
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
    </div>
  );
}
