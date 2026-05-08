import { Send } from "lucide-react";
import type { ReactNode } from "react";
import type { AnalysisResult, PrDetail, ReviewComment, ReviewProgress } from "../../../shared/types";
import type { DraftReviewComment } from "./CommentTab";
import { DiffViewer, extractFileDiff, type OverviewLinePin } from "./DiffViewer";
import { Badge, plural } from "./uiBits";

export function DiffTab({
  detail,
  analysis: _analysis,
  progress,
  reviewComments,
  expandedFile,
  trace,
  overviewPins,
  canApproveWithoutComments,
  onSaveProgress,
  onToggleExpandedFile,
  onAddReviewComment,
  onUpdateReviewComment,
  onDeleteReviewComment,
  onOpenReviewDialog
}: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  progress?: ReviewProgress;
  reviewComments: DraftReviewComment[];
  expandedFile?: string;
  trace: ReactNode;
  overviewPins: OverviewLinePin[];
  canApproveWithoutComments: boolean;
  onSaveProgress: (patch: Partial<Pick<ReviewProgress, "reviewedFiles">>) => void;
  onToggleExpandedFile: (path: string) => void;
  onAddReviewComment: (comment: ReviewComment) => void;
  onUpdateReviewComment: (id: string, body: string) => void;
  onDeleteReviewComment: (id: string) => void;
  onOpenReviewDialog: () => void;
}) {
  const reviewedFiles = new Set(progress?.reviewedFiles ?? []);
  const draftCount = reviewComments.filter((comment) => comment.body.trim().length > 0).length;

  function toggleReviewedFile(path: string) {
    const next = reviewedFiles.has(path)
      ? (progress?.reviewedFiles ?? []).filter((item) => item !== path)
      : [...(progress?.reviewedFiles ?? []), path];
    onSaveProgress({ reviewedFiles: next });
  }

  return (
    <div className="panel">
      {trace}
      <h3>Changed Files</h3>
      <div className="file-list expandable">
        {detail.files.map((file) => {
          const fileDraftCount = reviewComments.filter((comment) => comment.path === file.path && comment.body.trim()).length;
          const existingCount = detail.reviewComments.filter((comment) => comment.path === file.path).length;
          const pinCount = overviewPins.filter((pin) => pin.target.path === file.path).length;
          const reviewed = reviewedFiles.has(file.path);
          return (
            <section key={file.path} className="file-diff-card">
              <div className="file-review-strip">
                <Badge tone={reviewed ? "added" : "review-needed"}>{reviewed ? "reviewed" : "not reviewed"}</Badge>
                {fileDraftCount > 0 && <Badge tone="queue">{plural(fileDraftCount, "draft")}</Badge>}
                {existingCount > 0 && <Badge tone="feature">{plural(existingCount, "line comment")}</Badge>}
                {pinCount > 0 && <Badge tone="danger">{plural(pinCount, "review pin")}</Badge>}
                <button className="text-button" onClick={() => toggleReviewedFile(file.path)}>
                  {reviewed ? "Mark unreviewed" : "Mark reviewed"}
                </button>
              </div>
              <button className="file-toggle" onClick={() => onToggleExpandedFile(file.path)}>
                <span>{file.path}</span>
                <span className="change-counts">
                  <strong className="added">+{file.additions}</strong>
                  <strong className="deleted">-{file.deletions}</strong>
                </span>
              </button>
              {expandedFile === file.path && (
                <DiffViewer
                  diff={extractFileDiff(detail.diff, file.path)}
                  comments={reviewComments}
                  existingComments={detail.reviewComments}
                  overviewPins={overviewPins.filter((pin) => pin.target.path === file.path)}
                  onAddComment={onAddReviewComment}
                  onUpdateComment={onUpdateReviewComment}
                  onDeleteComment={onDeleteReviewComment}
                />
              )}
            </section>
          );
        })}
      </div>
      <div className="diff-toolbar">
        <h3>Changes</h3>
        <button disabled={draftCount === 0 && !canApproveWithoutComments} onClick={onOpenReviewDialog}>
          <Send size={16} />
          {submitReviewLabel(draftCount, canApproveWithoutComments)}
        </button>
      </div>
    </div>
  );
}

function submitReviewLabel(commentsCount: number, canApproveWithoutComments: boolean): string {
  if (commentsCount > 0) return "Submit review";
  return canApproveWithoutComments ? "Submit approval" : "Submit review";
}
