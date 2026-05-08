import { GitCommit } from "lucide-react";
import { useMemo, useState } from "react";

import type { AnalysisResult, PrCommit, PrDetail } from "../../../shared/types";
import { ColorizedDiff } from "./DiffCode";
import type { DraftReviewComment } from "./CommentTab";
import { AuthorLink, Badge, plural, relativeDate } from "./uiBits";
import "./commitTimeline.css";

type CommitStoryItem = {
  title: string;
  body: string;
  target?: string;
  tone: "danger" | "queue" | "added" | "neutral";
};

export function CommitTimeline({
  commits,
  detail,
  analysis,
  reviewComments
}: {
  commits: PrCommit[];
  detail: PrDetail;
  analysis?: AnalysisResult;
  reviewComments: DraftReviewComment[];
}) {
  const finalPaths = useMemo(() => new Set(detail.files.map((file) => file.path)), [detail.files]);
  if (commits.length === 0) {
    return (
      <div className="panel">
        <section className="summary-card">
          <h3>Commits</h3>
          <p className="muted">No commit details are available yet. Refresh the PR details to fetch commit-level file changes.</p>
        </section>
      </div>
    );
  }
  return (
    <div className="panel commit-panel">
      <CommitStory commits={commits} detail={detail} analysis={analysis} reviewComments={reviewComments} />
      <div className="panel-title">
        <div>
          <h3>Commits</h3>
          <p className="muted">{plural(commits.length, "commit")} with file-level changes.</p>
        </div>
      </div>
      <div className="commit-list">
        {commits.map((commit) => (
          <CommitCard commit={commit} finalPaths={finalPaths} key={commit.sha} />
        ))}
      </div>
    </div>
  );
}

function CommitStory({
  commits,
  detail,
  analysis,
  reviewComments
}: {
  commits: PrCommit[];
  detail: PrDetail;
  analysis?: AnalysisResult;
  reviewComments: DraftReviewComment[];
}) {
  const story = buildCommitStory(commits, detail, analysis, reviewComments);
  return (
    <section className="summary-card commit-story-card">
      <div className="panel-title">
        <div>
          <h3>Commit Story</h3>
          <p className="muted">A quick read on how the PR evolved before reviewing each commit.</p>
        </div>
        <GitCommit size={18} />
      </div>
      <div className="commit-story-list">
        {story.map((item) => (
          <article key={item.title} className={item.tone}>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function CommitCard({ commit, finalPaths }: { commit: PrCommit; finalPaths: Set<string> }) {
  const [expandedPath, setExpandedPath] = useState<string>();
  const additions = commit.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = commit.files.reduce((sum, file) => sum + file.deletions, 0);
  const survivingFiles = commit.files.filter((file) => finalPaths.has(file.path)).length;
  const likelyFollowup = /review|feedback|fix|address|test|docs?|cleanup/i.test(commit.message);
  return (
    <details className="commit-card" open>
      <summary>
        <span className="commit-main">
          <strong>{commit.message || commit.shortSha}</strong>
          <span>
            <a href={commit.url} target="_blank" rel="noreferrer">{commit.shortSha}</a>
            <span>by <AuthorLink name={commit.author} url={commit.authorUrl} /></span>
            <span>{relativeDate(commit.committedAt || commit.authoredAt)}</span>
          </span>
        </span>
        <span className="commit-stats">
          {likelyFollowup && <Badge tone="queue">follow-up</Badge>}
          <Badge tone={survivingFiles === commit.files.length ? "added" : "neutral"}>{survivingFiles}/{commit.files.length} in final diff</Badge>
          <b>{plural(commit.files.length, "file")}</b>
          <b className="added">+{additions}</b>
          <b className="deleted">-{deletions}</b>
        </span>
      </summary>
      <div className="commit-files">
        {commit.files.length === 0 ? (
          <p className="muted">No file changes reported for this commit.</p>
        ) : (
          commit.files.map((file) => (
            <div className="commit-file-change" key={`${commit.sha}-${file.path}`}>
              <button
                className={`commit-file-row ${expandedPath === file.path ? "active" : ""}`}
                onClick={() => setExpandedPath((current) => (current === file.path ? undefined : file.path))}
              >
                <span>
                  <strong>{file.path}</strong>
                  {file.previousPath && <small>renamed from {file.previousPath}</small>}
                </span>
                <em>{file.changeType?.toLowerCase() ?? "modified"}</em>
                <b className="added">+{file.additions}</b>
                <b className="deleted">-{file.deletions}</b>
              </button>
              {expandedPath === file.path && (
                <div className="commit-file-patch">
                  {file.patch?.trim() ? <ColorizedDiff diff={file.patch} /> : <p className="muted">No patch text is available for this file.</p>}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </details>
  );
}

function buildCommitStory(
  commits: PrCommit[],
  detail: PrDetail,
  analysis: AnalysisResult | undefined,
  reviewComments: DraftReviewComment[]
): CommitStoryItem[] {
  const items: CommitStoryItem[] = [];
  const first = commits[0];
  const last = commits.at(-1);
  if (first) {
    items.push({
      title: "Starting point",
      body: first.message || `Initial commit ${first.shortSha}`,
      target: relativeDate(first.committedAt || first.authoredAt),
      tone: "neutral"
    });
  }
  if (commits.length > 1 && last) {
    const feedbackCommit = commits.find((commit) => /review|feedback|fix|address|test|docs?/i.test(commit.message));
    items.push({
      title: feedbackCommit ? "Review feedback appears addressed" : "Multiple commits",
      body: feedbackCommit?.message || `${commits.length} commits make up the final PR diff.`,
      target: feedbackCommit?.shortSha || last.shortSha,
      tone: feedbackCommit ? "added" : "neutral"
    });
  }
  const sourceLines = sourceChangedLines(detail);
  const supportLines = detail.files.reduce((sum, file) => sum + file.additions + file.deletions, 0) - sourceLines;
  items.push({
    title: sourceLines > supportLines ? "Source-heavy PR" : "Support-heavy PR",
    body: `${sourceLines} source lines and ${supportLines} test/docs/support lines changed.`,
    tone: sourceLines > 250 ? "queue" : "neutral"
  });
  const largest = [...detail.files].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))[0];
  if (largest) {
    items.push({
      title: "Largest changed file",
      body: `${largest.path} has +${largest.additions}/-${largest.deletions}.`,
      target: largest.path,
      tone: largest.additions + largest.deletions > 200 ? "queue" : "neutral"
    });
  }
  if (reviewComments.some((comment) => comment.body.trim())) {
    items.push({
      title: "Draft comments pending",
      body: `${plural(reviewComments.filter((comment) => comment.body.trim()).length, "draft comment")} should be submitted or cleared before final review.`,
      tone: "queue"
    });
  }
  if (analysis?.riskDetails?.some((risk) => risk.severity === "high")) {
    items.push({
      title: "High-risk findings exist",
      body: "Review commit history for whether later commits actually address the highest-risk points.",
      tone: "danger"
    });
  }
  return items;
}

function sourceChangedLines(detail: PrDetail): number {
  return detail.files
    .filter((file) => !isDocsPath(file.path) && !isTestPath(file.path))
    .reduce((sum, file) => sum + file.additions + file.deletions, 0);
}

function isTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.endsWith("test.java") ||
    lower.endsWith("test.kt") ||
    lower.endsWith("spec.groovy") ||
    lower.endsWith(".spec.ts") ||
    lower.endsWith(".test.ts") ||
    lower.endsWith(".spec.tsx") ||
    lower.endsWith(".test.tsx")
  );
}

function isDocsPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.startsWith("docs/") || lower.startsWith("src/main/docs/") || lower.endsWith(".adoc") || lower.endsWith(".md") || lower.endsWith(".rst") || lower.endsWith(".txt");
}
