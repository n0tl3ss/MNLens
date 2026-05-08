import { CheckCircle2 } from "lucide-react";
import type { CiCheck, FixJob, PrDetail, ReviewProgress, VerificationJob } from "../../../shared/types";
import { Badge } from "./uiBits";

type ReviewDeltaItem = {
  key: string;
  kind: "commit" | "comment" | "ci" | "local" | "fix";
  title: string;
  detail: string;
  at: string;
  tone: string;
};

export type ReviewReplay = {
  label: string;
  tone: string;
  summary: string;
  files: string[];
  actions: string[];
};

export function ReviewDeltaSection({
  detail,
  progress,
  ciChecks,
  verificationJobs,
  fixJobs,
  onMarkReviewed
}: {
  detail: PrDetail;
  progress?: ReviewProgress;
  ciChecks: CiCheck[];
  verificationJobs: VerificationJob[];
  fixJobs: FixJob[];
  onMarkReviewed: () => void;
}) {
  const delta = reviewDelta(detail, progress, ciChecks, verificationJobs, fixJobs);
  const visible = delta.items.slice(0, 6);
  return (
    <section className={`summary-card review-delta-card ${delta.tone}`}>
      <div className="panel-title">
        <div>
          <h3>Since Last Review</h3>
          <p className="muted">{delta.summary}</p>
        </div>
        <button onClick={onMarkReviewed}>
          <CheckCircle2 size={16} />
          Mark current state reviewed
        </button>
      </div>
      {progress?.lastReviewedAt && <p className="delta-baseline">Last reviewed {relativeDate(progress.lastReviewedAt)}</p>}
      {visible.length === 0 ? (
        <div className="delta-empty">
          <CheckCircle2 size={18} />
          <span>{progress?.lastReviewedAt ? "No new commits, comments, CI, or local actions since your last checkpoint." : "No local checkpoint yet. Mark reviewed after you finish this pass."}</span>
        </div>
      ) : (
        <div className="delta-list">
          {visible.map((item) => (
            <article key={item.key} className={item.tone}>
              <Badge tone={item.tone}>{item.kind}</Badge>
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
              <span>{relativeDate(item.at)}</span>
            </article>
          ))}
        </div>
      )}
      {delta.items.length > visible.length && <p className="muted">+{delta.items.length - visible.length} more updates since the last checkpoint.</p>}
      <ReviewReplayPanel replay={reviewReplay(detail, progress, ciChecks, verificationJobs, fixJobs)} />
    </section>
  );
}

function ReviewReplayPanel({ replay }: { replay: ReviewReplay }) {
  return (
    <div className={`review-replay ${replay.tone}`}>
      <div>
        <strong>Review replay</strong>
        <Badge tone={replay.tone}>{replay.label}</Badge>
      </div>
      <p>{replay.summary}</p>
      {replay.files.length > 0 && (
        <div className="replay-files">
          {replay.files.slice(0, 8).map((file) => (
            <Badge key={file} tone="neutral">
              {file}
            </Badge>
          ))}
          {replay.files.length > 8 && <Badge tone="neutral">+{replay.files.length - 8} more files</Badge>}
        </div>
      )}
      {replay.actions.length > 0 && (
        <ul>
          {replay.actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function reviewDelta(
  detail: PrDetail,
  progress: ReviewProgress | undefined,
  ciChecks: CiCheck[],
  verificationJobs: VerificationJob[],
  fixJobs: FixJob[]
): { items: ReviewDeltaItem[]; summary: string; tone: string } {
  const baseline = progress?.lastReviewedAt;
  const baselineMs = baseline ? Date.parse(baseline) : Number.NaN;
  const hasBaseline = Number.isFinite(baselineMs);
  const items: ReviewDeltaItem[] = [];
  const include = (value: string) => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) && (!hasBaseline || ms > baselineMs);
  };
  for (const commit of detail.commits ?? []) {
    const at = commit.committedAt || commit.authoredAt;
    if (include(at)) {
      items.push({
        key: `commit:${commit.sha}`,
        kind: "commit",
        title: commit.message.split("\n")[0] || commit.shortSha,
        detail: `${commit.shortSha} by ${commit.author}, ${plural(commit.files?.length ?? 0, "file")}`,
        at,
        tone: "improvement"
      });
    }
  }
  for (const comment of detail.conversationComments ?? []) {
    if (include(comment.createdAt)) {
      items.push({
        key: `conversation:${comment.id}`,
        kind: "comment",
        title: `Conversation comment by ${comment.author}`,
        detail: compactText(comment.body),
        at: comment.createdAt,
        tone: "neutral"
      });
    }
  }
  for (const review of detail.reviewSummaries ?? []) {
    if (include(review.createdAt)) {
      items.push({
        key: `review:${review.id}`,
        kind: "comment",
        title: `${review.state || "Review"} by ${review.author}`,
        detail: compactText(review.body || "Review summary updated."),
        at: review.createdAt,
        tone: /changes_requested/i.test(review.state) ? "danger" : /approved/i.test(review.state) ? "added" : "neutral"
      });
    }
  }
  for (const comment of detail.reviewComments ?? []) {
    if (include(comment.createdAt)) {
      items.push({
        key: `line-comment:${comment.id}`,
        kind: "comment",
        title: `Line comment by ${comment.author}`,
        detail: `${comment.path}${comment.line ? `:${comment.line}` : ""} - ${compactText(comment.body)}`,
        at: comment.createdAt,
        tone: "queue"
      });
    }
  }
  for (const check of ciChecks) {
    const at = usableCheckTime(check);
    if (at && include(at)) {
      items.push({
        key: `ci:${check.link || check.name}`,
        kind: "ci",
        title: check.name,
        detail: `${check.state || check.bucket || "unknown"} in ${check.workflow || "GitHub CI"}`,
        at,
        tone: toneForCi(check)
      });
    }
  }
  for (const job of latestVerificationJobs(verificationJobs)) {
    if (include(job.updatedAt)) {
      items.push({
        key: `verification:${job.id}`,
        kind: "local",
        title: job.status === "done" ? "Local verification finished" : `Local verification ${job.status}`,
        detail: `${job.command}${typeof job.exitCode === "number" ? `, exit ${job.exitCode}` : ""}`,
        at: job.updatedAt,
        tone: job.status === "failed" || (typeof job.exitCode === "number" && job.exitCode !== 0) ? "danger" : job.status === "done" ? "added" : "queue"
      });
    }
  }
  for (const job of fixJobs) {
    if (include(job.updatedAt)) {
      items.push({
        key: `fix:${job.id}`,
        kind: "fix",
        title: job.status === "done" ? "Codex fix preview updated" : `Codex fix ${job.status}`,
        detail: `${job.source ?? "Fix session"}${job.pushed ? ", pushed" : job.diff?.trim() ? ", prepared diff" : ""}`,
        at: job.updatedAt,
        tone: job.status === "failed" ? "danger" : job.status === "done" ? "added" : "queue"
      });
    }
  }
  const sorted = items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const summary = hasBaseline
    ? sorted.length === 0
      ? `No new activity since ${relativeDate(baseline!)}.`
      : `${plural(sorted.length, "update")} since ${relativeDate(baseline!)}. Start with the newest item.`
    : "No local checkpoint yet. Mark reviewed once you finish this review pass.";
  const tone = sorted.some((item) => item.tone === "danger") ? "danger" : sorted.length > 0 ? "queue" : "added";
  return { items: sorted, summary, tone };
}

export function reviewReplay(
  detail: PrDetail,
  progress: ReviewProgress | undefined,
  ciChecks: CiCheck[],
  verificationJobs: VerificationJob[],
  fixJobs: FixJob[]
): ReviewReplay {
  const baseline = progress?.lastReviewedAt;
  const baselineMs = baseline ? Date.parse(baseline) : Number.NaN;
  const hasBaseline = Number.isFinite(baselineMs);
  const isNew = (value: string) => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) && (!hasBaseline || ms > baselineMs);
  };
  const newCommits = (detail.commits ?? []).filter((commit) => isNew(commit.committedAt || commit.authoredAt));
  const files = [...new Set(newCommits.flatMap((commit) => (commit.files ?? []).map((file) => file.path)))];
  const newLineComments = (detail.reviewComments ?? []).filter((comment) => isNew(comment.createdAt));
  const newConversation = (detail.conversationComments ?? []).filter((comment) => isNew(comment.createdAt));
  const newFailingCi = ciChecks.filter((check) => toneForCi(check) === "danger" && usableCheckTime(check) && isNew(usableCheckTime(check)));
  const newFixes = fixJobs.filter((job) => isNew(job.updatedAt));
  const newVerification = latestVerificationJobs(verificationJobs).filter((job) => isNew(job.updatedAt));
  const actions: string[] = [];
  if (files.length > 0) actions.push(`Re-open ${plural(files.length, "changed file")} touched by new commits.`);
  if (newLineComments.length > 0) actions.push(`Review ${plural(newLineComments.length, "new line comment")} and check whether each is addressed.`);
  if (newConversation.length > 0) actions.push(`Read ${plural(newConversation.length, "new conversation comment")} before final decision.`);
  if (newFailingCi.length > 0) actions.push(`Explain or fix ${plural(newFailingCi.length, "new failing CI check")}.`);
  if (newFixes.some((job) => job.diff?.trim() || job.pushed)) actions.push("Inspect Codex fix changes and rerun/recheck affected tests.");
  if (newVerification.some((job) => job.status === "failed")) actions.push("Open failed local verification output before approving.");

  if (!hasBaseline) {
    return {
      label: "no checkpoint",
      tone: "queue",
      summary: "Mark current state reviewed after this pass; future updates will replay only what changed.",
      files: [],
      actions: ["Complete the first review pass, then use Mark current state reviewed."]
    };
  }
  if (actions.length === 0) {
    return {
      label: "no replay needed",
      tone: "added",
      summary: "No commits, comments, CI failures, local checks, or fix activity changed since your checkpoint.",
      files: [],
      actions: []
    };
  }
  const danger = newFailingCi.length > 0 || newVerification.some((job) => job.status === "failed");
  return {
    label: danger ? "replay blockers" : "replay updates",
    tone: danger ? "danger" : "queue",
    summary: `${plural(actions.length, "review replay item")} changed since ${relativeDate(baseline!)}.`,
    files,
    actions
  };
}

function latestVerificationJobs(jobs: VerificationJob[]): VerificationJob[] {
  const latest = new Map<string, VerificationJob>();
  for (const job of [...jobs].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    latest.set(commandKey(job.command), job);
  }
  return [...latest.values()];
}

function commandKey(command: string): string {
  return command
    .trim()
    .replace(/[`"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.)\]]+$/g, "")
    .trim();
}

function usableCheckTime(check: CiCheck): string {
  return [check.completedAt, check.startedAt].find((value) => value && !value.startsWith("0001-")) ?? "";
}

function compactText(value: string, limit = 140): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text || "No body.";
}

function toneForCi(check: CiCheck): string {
  if (check.bucket === "pass" || check.state === "SUCCESS") return "added";
  if (check.bucket === "fail" || /fail|error|cancel/i.test(check.state)) return "danger";
  if (check.bucket === "pending" || /pending|queued|in_progress/i.test(check.state)) return "queue";
  return "neutral";
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

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
