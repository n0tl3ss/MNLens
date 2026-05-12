import { Send } from "lucide-react";
import type { AnalysisResult, PrDetail, PrFile, ReviewComment, ReviewProgress } from "../../../shared/types";
import { isDocsPath, isTestPath } from "../reviewHelpers";
import type { DraftReviewComment } from "./CommentTab";
import { DiffViewer, extractFileDiff, type OverviewLinePin } from "./DiffViewer";
import { Badge, plural } from "./uiBits";

export function DiffTab({
  detail,
  analysis: _analysis,
  progress,
  reviewComments,
  expandedFile,
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
  const groupedFiles = groupChangedFiles(detail.files);

  function toggleReviewedFile(path: string) {
    const next = reviewedFiles.has(path)
      ? (progress?.reviewedFiles ?? []).filter((item) => item !== path)
      : [...(progress?.reviewedFiles ?? []), path];
    onSaveProgress({ reviewedFiles: next });
  }

  return (
    <div className="panel">
      <h3>Changed Files</h3>
      <div className="file-list expandable">
        {groupedFiles.map((group) => (
          <section className={`changed-file-group ${group.id}`} key={group.id}>
            <div className="changed-file-group-heading">
              <h4>{group.label}</h4>
              <span>{plural(group.files.length, "file")}</span>
            </div>
            <div className="changed-file-tree">
              {group.roots.map((root) => (
                <div className="changed-file-root" key={root.root}>
                  <div className="changed-file-root-label">{root.root}</div>
                  {root.commonPrefix && <div className="changed-file-common-prefix">{root.commonPrefix}</div>}
                  {root.files.map((file) => {
                    const fileDraftCount = reviewComments.filter((comment) => comment.path === file.path && comment.body.trim()).length;
                    const existingCount = detail.reviewComments.filter((comment) => comment.path === file.path).length;
                    const pinCount = overviewPins.filter((pin) => pin.target.path === file.path).length;
                    const reviewed = reviewedFiles.has(file.path);
                    return (
                      <section key={file.path} className="file-diff-card">
                        <button className="file-toggle" onClick={() => onToggleExpandedFile(file.path)} title={file.path}>
                          <span>
                            <em>
                              {relativeTreePath(file.path, root)}
                              <b className={`file-change-type ${fileChangeTone(file.changeType)}`}>{fileChangeLabel(file.changeType)}</b>
                            </em>
                          </span>
                          <span className="change-counts">
                            <strong className="added">+{file.additions}</strong>
                            <strong className="deleted">-{file.deletions}</strong>
                          </span>
                        </button>
                        <div className="file-review-strip">
                          <Badge tone={reviewed ? "added" : "review-needed"}>{reviewed ? "reviewed" : "not reviewed"}</Badge>
                          {fileDraftCount > 0 && <Badge tone="queue">{plural(fileDraftCount, "draft")}</Badge>}
                          {existingCount > 0 && <Badge tone="feature">{plural(existingCount, "line comment")}</Badge>}
                          {pinCount > 0 && <Badge tone="danger">{plural(pinCount, "review pin")}</Badge>}
                          <button className="text-button" onClick={() => toggleReviewedFile(file.path)}>
                            {reviewed ? "Mark unreviewed" : "Mark reviewed"}
                          </button>
                        </div>
                        {expandedFile === file.path && (
                          <DiffViewer
                            diff={extractFileDiff(detail.diff, file.path)}
                            detail={detail}
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
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="diff-toolbar">
        <h3>Changes</h3>
        <button onClick={onOpenReviewDialog}>
          <Send size={16} />
          {submitReviewLabel(draftCount, canApproveWithoutComments)}
        </button>
      </div>
    </div>
  );
}

type FileGroup = {
  id: "source" | "tests" | "docs" | "support";
  label: string;
  files: PrFile[];
  roots: FileRootGroup[];
};

type FileRootGroup = { root: string; commonPrefix: string; files: PrFile[] };

function groupChangedFiles(files: PrFile[]): FileGroup[] {
  const groups: Array<Omit<FileGroup, "files" | "roots"> & { files: PrFile[] }> = [
    { id: "source", label: "Source", files: [] },
    { id: "tests", label: "Tests", files: [] },
    { id: "docs", label: "Docs", files: [] },
    { id: "support", label: "Support", files: [] }
  ];
  for (const file of files) {
    groups.find((group) => group.id === fileGroupId(file.path))?.files.push(file);
  }
  return groups
    .filter((group) => group.files.length > 0)
    .map((group) => ({
      ...group,
      roots: groupByRoot(group.files)
    }));
}

function fileGroupId(path: string): FileGroup["id"] {
  if (isDocsPath(path)) return "docs";
  if (isTestPath(path)) return "tests";
  if (isSourcePath(path)) return "source";
  return "support";
}

function isSourcePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes("/src/main/") || lower.startsWith("src/") || /\.(java|kt|groovy|scala|ts|tsx|js|jsx|go|rs|py|rb|c|cc|cpp|h|hpp)$/.test(lower);
}

function groupByRoot(files: PrFile[]): FileRootGroup[] {
  const roots = new Map<string, PrFile[]>();
  for (const file of files) {
    const root = commonRoot(file.path);
    roots.set(root, [...(roots.get(root) ?? []), file]);
  }
  return [...roots.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([root, rootFiles]) => {
      const sorted = rootFiles.sort((left, right) => left.path.localeCompare(right.path));
      return { root, commonPrefix: commonRelativeDirectoryPrefix(root, sorted), files: sorted };
    });
}

function commonRoot(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 2) return parts[0] ?? path;
  if (parts.includes("src")) {
    const srcIndex = parts.indexOf("src");
    return srcIndex > 0 ? parts[0] : parts.slice(0, Math.min(3, parts.length - 1)).join("/");
  }
  if (parts[0] === "src" && parts.length > 2) return parts.slice(0, 3).join("/");
  return parts.slice(0, Math.min(2, parts.length - 1)).join("/");
}

function commonRelativeDirectoryPrefix(root: string, files: PrFile[]): string {
  const relativeDirs = files
    .map((file) => relativeTreePath(file.path, { root, commonPrefix: "" }).split("/").slice(0, -1))
    .filter((parts) => parts.length > 0);
  if (relativeDirs.length === 1) {
    return singleFileDirectoryPrefix(relativeDirs[0]);
  }
  if (relativeDirs.length < 2) return "";
  const [first, ...rest] = relativeDirs;
  const common: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const part = first[index];
    if (!part || rest.some((parts) => parts[index] !== part)) break;
    common.push(part);
  }
  return common.length >= 2 ? common.join("/") : "";
}

function singleFileDirectoryPrefix(parts: string[]): string {
  return parts.length > 0 ? parts.join("/") : "";
}

function relativeTreePath(path: string, root: Pick<FileRootGroup, "root" | "commonPrefix">): string {
  let relative = path === root.root ? path : path.startsWith(`${root.root}/`) ? path.slice(root.root.length + 1) : path;
  if (root.commonPrefix && relative.startsWith(`${root.commonPrefix}/`)) relative = relative.slice(root.commonPrefix.length + 1);
  return relative;
}

function fileChangeLabel(changeType?: string): string {
  const normalized = (changeType ?? "").toUpperCase();
  if (normalized.includes("ADD")) return "added";
  if (normalized.includes("DELETE") || normalized.includes("REMOVE")) return "deleted";
  if (normalized.includes("RENAME")) return "renamed";
  if (normalized.includes("COPY")) return "copied";
  return "modified";
}

function fileChangeTone(changeType?: string): string {
  const label = fileChangeLabel(changeType);
  if (label === "added") return "added";
  if (label === "deleted") return "deleted";
  if (label === "renamed" || label === "copied") return "renamed";
  return "modified";
}

function submitReviewLabel(commentsCount: number, canApproveWithoutComments: boolean): string {
  if (commentsCount > 0) return "Submit review";
  return canApproveWithoutComments ? "Approve" : "Review / Approve";
}
