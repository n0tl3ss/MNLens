import { CheckCircle2, Loader2, X } from "lucide-react";
import { useState } from "react";
import type { FixJob, Job, JobStatus, PrListItem, VerificationJob } from "../../../shared/types";
import type { Tab } from "../reviewTypes";
import { Badge, plural, relativeDate } from "./uiBits";
import "./workActivity.css";

export type WorkActivityItem = {
  id: string;
  jobId: string;
  prKey: string;
  title: string;
  kind: "Analysis" | "Codex fix" | "Local test";
  targetTab: Tab;
  status: JobStatus;
  detail: string;
  updatedAt: string;
};

export function WorkActivityPanel({
  activity,
  onSelectActivity,
  onCancelActivity,
  onCancelQueuedActivity
}: {
  activity: WorkActivityItem[];
  onSelectActivity: (item: WorkActivityItem) => void;
  onCancelActivity?: (item: WorkActivityItem) => void;
  onCancelQueuedActivity?: () => void;
}) {
  const [view, setView] = useState<"active" | "history">("active");
  const active = activity
    .filter((item) => isLiveStatus(item.status))
    .sort(compareActiveActivity);
  const history = activity
    .filter((item) => !isLiveStatus(item.status))
    .sort(compareActivityUpdatedAt);
  const visible = view === "active" ? active : history;
  const queued = active.filter((item) => item.status === "queued").length;
  const running = active.filter((item) => item.status === "running").length;
  const analysis = visible.filter((item) => item.kind === "Analysis");
  const fixes = visible.filter((item) => item.kind === "Codex fix");
  const local = visible.filter((item) => item.kind === "Local test");
  return (
    <section className={`work-activity ${active.length > 0 ? "active" : ""}`} aria-live="polite">
      <div className="work-activity-header">
        <div>
          <strong>Tool activity</strong>
          <span>{active.length > 0 ? `${running} running, ${queued} queued` : "Idle"} · {plural(history.length, "finished")}</span>
        </div>
        {active.length > 0 ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
      </div>
      <div className="work-activity-tabs" role="tablist" aria-label="Tool activity views">
        <button type="button" className={view === "active" ? "active" : ""} onClick={() => setView("active")}>
          Active <span>{active.length}</span>
        </button>
        <button type="button" className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
          History <span>{history.length}</span>
        </button>
      </div>
      <div className="work-activity-counts">
        <Badge tone={analysis.length > 0 ? "queue" : "neutral"}>{plural(analysis.length, "analysis job")}</Badge>
        <Badge tone={fixes.length > 0 ? "queue" : "neutral"}>{plural(fixes.length, "fix session")}</Badge>
        <Badge tone={local.length > 0 ? "feature" : "neutral"}>{plural(local.length, "local run")}</Badge>
        {view === "active" && queued > 0 && onCancelQueuedActivity && (
          <button type="button" className="work-activity-cancel-queued" onClick={onCancelQueuedActivity}>
            Cancel queued
          </button>
        )}
      </div>
      {visible.length > 0 ? (
        <div className="work-activity-list">
          {visible.map((item) => (
            <article key={item.id} className="work-activity-row">
              <button type="button" className="work-activity-open" onClick={() => onSelectActivity(item)} title={`Open ${item.title} in ${tabLabel(item.targetTab)}`}>
                <span>
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  <b>{item.kind}</b>
                  <em>{tabLabel(item.targetTab)}</em>
                  <em>{relativeDate(item.updatedAt)}</em>
                </span>
                <strong>{item.title}</strong>
                <em>{item.detail}</em>
              </button>
              {onCancelActivity && isLiveStatus(item.status) && (
                <button type="button" className="work-activity-cancel" onClick={() => onCancelActivity(item)} title={`Cancel ${item.kind.toLowerCase()}`}>
                  <X size={13} />
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="work-activity-empty">{view === "active" ? "No running or queued work." : "No finished sessions yet."}</p>
      )}
    </section>
  );
}

export function workActivityForPrs(prs: PrListItem[], jobs: Job[], verificationJobs: VerificationJob[], fixJobs: FixJob[]): WorkActivityItem[] {
  const titleFor = (key: string) => prs.find((pr) => pr.key === key)?.title ?? key;
  const analysis = jobs
    .map((job): WorkActivityItem => ({
      id: `analysis:${job.id}`,
      jobId: job.id,
      prKey: job.prKey,
      title: titleFor(job.prKey),
      kind: "Analysis",
      targetTab: "overview",
      status: job.status,
      detail: analysisDetail(job),
      updatedAt: job.updatedAt
    }));
  const fixes = fixJobs
    .map((job): WorkActivityItem => ({
      id: `fix:${job.id}`,
      jobId: job.id,
      prKey: job.prKey,
      title: titleFor(job.prKey),
      kind: "Codex fix",
      targetTab: "fix",
      status: job.status,
      detail: fixDetail(job),
      updatedAt: job.updatedAt
    }));
  const local = verificationJobs
    .map((job): WorkActivityItem => ({
      id: `verification:${job.id}`,
      jobId: job.id,
      prKey: job.prKey,
      title: titleFor(job.prKey),
      kind: "Local test",
      targetTab: "overview",
      status: job.status,
      detail: verificationDetail(job),
      updatedAt: job.updatedAt
    }));
  return [...fixes, ...analysis, ...local]
    .sort(compareActiveActivity);
}

export function isLiveWorkActivity(item: WorkActivityItem): boolean {
  return isLiveStatus(item.status);
}

function isLiveStatus(status: JobStatus): boolean {
  return status === "queued" || status === "running";
}

function statusPriority(status: JobStatus): number {
  if (status === "running") return 3;
  if (status === "queued") return 2;
  if (status === "failed") return 1;
  return 0;
}

function compareActiveActivity(a: WorkActivityItem, b: WorkActivityItem): number {
  return statusPriority(b.status) - statusPriority(a.status) || compareActivityUpdatedAt(a, b);
}

function compareActivityUpdatedAt(a: WorkActivityItem, b: WorkActivityItem): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function statusTone(status: JobStatus): string {
  if (status === "done") return "added";
  if (status === "failed") return "danger";
  if (status === "running") return "queue";
  return "neutral";
}

function analysisDetail(job: Job): string {
  if (job.status === "failed") return job.error || job.statusMessage || "Analysis failed.";
  if (job.status === "done") return job.statusMessage || (job.mode === "fast" ? "Fast score analysis completed." : "Analysis completed.");
  return job.statusMessage || (job.mode === "fast" ? "Estimating score from lightweight PR metadata." : "Classifying PR and building review guidance.");
}

function fixDetail(job: FixJob): string {
  if (job.status === "failed") return [job.phase ? phaseLabel(job.phase) : undefined, job.error || job.statusMessage || "Codex fix failed."].filter(Boolean).join(" - ");
  if (job.status === "done") {
    return job.pushed
      ? `Pushed${job.commitSha ? ` ${job.commitSha}` : ""}.`
      : job.committed
        ? "Fix committed locally."
        : job.statusMessage || "Fix preview ready.";
  }
  return [job.phase ? phaseLabel(job.phase) : undefined, job.statusMessage].filter(Boolean).join(" - ") || "Preparing code changes for review.";
}

function verificationDetail(job: VerificationJob): string {
  if (job.status === "failed") return job.error || job.statusMessage || `Failed${typeof job.exitCode === "number" ? `, exit ${job.exitCode}` : ""}: ${job.command}`;
  if (job.status === "done") return job.statusMessage || `Finished${typeof job.exitCode === "number" ? `, exit ${job.exitCode}` : ""}: ${job.command}`;
  return job.statusMessage || job.command;
}

export function phaseLabel(phase: NonNullable<FixJob["phase"]>): string {
  return phase
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("/");
}

function tabLabel(tab: Tab): string {
  if (tab === "fix") return "Codex";
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}
