import { X } from "lucide-react";

import type { ReviewDecision } from "../../../shared/types";
import "./reviewDialog.css";

/**
 * Final gate before anything reaches GitHub. For someone else's PR the
 * reviewer picks Approve / Request changes / Comment. For the reviewer's own
 * PR (self-review of agent-generated code) GitHub only accepts a comment-only
 * review, so that is the single option and the copy says why.
 */
export function ReviewDialog({
  commentsCount,
  canApproveWithoutComments,
  selfReview = false,
  body,
  submitting,
  onBodyChange,
  onClose,
  onSubmit
}: {
  commentsCount: number;
  canApproveWithoutComments: boolean;
  /** The signed-in user authored this PR. */
  selfReview?: boolean;
  body: string;
  submitting: boolean;
  onBodyChange: (body: string) => void;
  onClose: () => void;
  onSubmit: (event: ReviewDecision) => void;
}) {
  const hasBody = body.trim().length > 0;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-modal-title">
        <div className="panel-title">
          <div>
            <h3 id="review-modal-title">{selfReview ? "Post self-review notes" : "Submit Review"}</h3>
            <p className="muted">
              {selfReview
                ? `This is your own PR. GitHub does not allow approving or requesting changes on it, so the ${commentsCount > 0 ? `${commentsCount} line comment${commentsCount === 1 ? "" : "s"} and ` : ""}summary are posted as a comment-only review. Fix what you found (Improve PR with the agent), then request a reviewer.`
                : commentsCount > 0
                  ? `${commentsCount} line comments will be posted to GitHub.`
                  : canApproveWithoutComments
                    ? "No line comments drafted. The completed review plan can be approved."
                    : "No line comments drafted. You can still approve with an optional summary."}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <textarea
          className="review-body"
          value={body}
          placeholder={selfReview ? "What you checked, what still needs work, what reviewers should look at" : "Optional overall review summary"}
          onChange={(event) => onBodyChange(event.target.value)}
        />
        <div className="review-actions">
          {selfReview ? (
            <button className="primary" disabled={submitting || (commentsCount === 0 && !hasBody)} onClick={() => onSubmit("COMMENT")} title={commentsCount === 0 && !hasBody ? "Write a summary or add a line comment first" : "Post as a comment-only review on your PR"}>
              {commentsCount > 0 ? `Post ${commentsCount} comment${commentsCount === 1 ? "" : "s"} on my PR` : "Post self-review comment"}
            </button>
          ) : (
            <>
              <button disabled={submitting || (commentsCount === 0 && !hasBody)} onClick={() => onSubmit("COMMENT")} title="Post comments without a verdict">
                Comment only
              </button>
              <button disabled={submitting} onClick={() => onSubmit("REQUEST_CHANGES")}>
                PR owner needs to address comments
              </button>
              <button disabled={submitting} onClick={() => onSubmit("APPROVE")}>
                {commentsCount > 0 ? "Approve with comments" : "Approve"}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
