import { X } from "lucide-react";

import type { ReviewDecision } from "../../../shared/types";
import "./reviewDialog.css";

export function ReviewDialog({
  commentsCount,
  canApproveWithoutComments,
  body,
  submitting,
  onBodyChange,
  onClose,
  onSubmit
}: {
  commentsCount: number;
  canApproveWithoutComments: boolean;
  body: string;
  submitting: boolean;
  onBodyChange: (body: string) => void;
  onClose: () => void;
  onSubmit: (event: ReviewDecision) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-modal-title">
        <div className="panel-title">
          <div>
            <h3 id="review-modal-title">Submit Review</h3>
            <p className="muted">
              {commentsCount > 0
                ? `${commentsCount} line comments will be posted to GitHub.`
                : canApproveWithoutComments
                  ? "No line comments drafted. The completed review plan can be approved."
                  : "Add comments or complete the review plan before approving."}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <textarea
          className="review-body"
          value={body}
          placeholder="Optional overall review summary"
          onChange={(event) => onBodyChange(event.target.value)}
        />
        <div className="review-actions">
          <button disabled={submitting} onClick={() => onSubmit("REQUEST_CHANGES")}>
            PR owner needs to address comments
          </button>
          <button disabled={submitting || (commentsCount === 0 && !canApproveWithoutComments)} onClick={() => onSubmit("APPROVE")}>
            {commentsCount > 0 ? "Approve with comments" : "Approve"}
          </button>
        </div>
      </section>
    </div>
  );
}
