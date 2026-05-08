import { CheckCircle2, Loader2, X } from "lucide-react";
import type { FixJob, Job, JobStatus, PrListItem, VerificationJob } from "../../../shared/types";
import type { Tab } from "../reviewTypes";
import { Badge, plural } from "./uiBits";
import "./workActivity.css";

export type WorkActivityItem = {
  id: string;
  jobId: string;
  prKey: string;
  title: string;
  kind: "Analysis" | "Codex fix" | "Local test";
  targetTab: Tab;
  status: "queued" | "running";
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
  const queued = activity.filter((item) => item.status === "queued").length;
  const running = activity.filter((item) => item.status === "running").length;
  const analysis = activity.filter((item) => item.kind === "Analysis");
  const fixes = activity.filter((item) => item.kind === "Codex fix");
  const local = activity.filter((item) => item.kind === "Local test");
  return (
    <section className={`work-activity ${activity.length > 0 ? "active" : ""}`} aria-live="polite">
      <div className="work-activity-header">
        <div>
          <strong>Tool activity</strong>
          <span>{activity.length > 0 ? `${running} running, ${queued} queued` : "Idle"}</span>
        </div>
        {activity.length > 0 ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
      </div>
      <div className="work-activity-counts">
        <Badge tone={analysis.length > 0 ? "queue" : "neutral"}>{plural(analysis.length, "analysis job")}</Badge>
        <Badge tone={fixes.length > 0 ? "queue" : "neutral"}>{plural(fixes.length, "fix session")}</Badge>
        <Badge tone={local.length > 0 ? "feature" : "neutral"}>{plural(local.length, "local run")}</Badge>
        {queued > 0 && onCancelQueuedActivity && (
          <button type="button" className="work-activity-cancel-queued" onClick={onCancelQueuedActivity}>
            Cancel queued
          </button>
        )}
      </div>
      {activity.length > 0 && (
        <div className="work-activity-list">
          {activity.map((item) => (
            <article key={item.id} className="work-activity-row">
              <button type="button" className="work-activity-open" onClick={() => onSelectActivity(item)} title={`Open ${item.title} in ${tabLabel(item.targetTab)}`}>
                <span>
                  <Badge tone={item.status === "running" ? "queue" : "neutral"}>{item.status}</Badge>
                  <b>{item.kind}</b>
                  <em>{tabLabel(item.targetTab)}</em>
                </span>
                <strong>{item.title}</strong>
                <em>{item.detail}</em>
              </button>
              {onCancelActivity && (
                <button type="button" className="work-activity-cancel" onClick={() => onCancelActivity(item)} title={`Cancel ${item.kind.toLowerCase()}`}>
                  <X size={13} />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function workActivityForPrs(prs: PrListItem[], jobs: Job[], verificationJobs: VerificationJob[], fixJobs: FixJob[]): WorkActivityItem[] {
  const titleFor = (key: string) => prs.find((pr) => pr.key === key)?.title ?? key;
  const isLive = (status: JobStatus) => status === "queued" || status === "running";
  const analysis = jobs
    .filter((job) => isLive(job.status))
    .map((job): WorkActivityItem => ({
      id: `analysis:${job.id}`,
      jobId: job.id,
      prKey: job.prKey,
      title: titleFor(job.prKey),
      kind: "Analysis",
      targetTab: "fix",
      status: job.status as "queued" | "running",
      detail: job.mode === "fast" ? "Estimating score from lightweight PR metadata." : "Classifying PR and building review guidance.",
      updatedAt: job.updatedAt
    }));
  const fixes = fixJobs
    .filter((job) => isLive(job.status))
    .map((job): WorkActivityItem => ({
      id: `fix:${job.id}`,
      jobId: job.id,
      prKey: job.prKey,
      title: titleFor(job.prKey),
      kind: "Codex fix",
      targetTab: "fix",
      status: job.status as "queued" | "running",
      detail: [job.phase ? phaseLabel(job.phase) : undefined, job.statusMessage].filter(Boolean).join(" - ") || "Preparing code changes for review.",
      updatedAt: job.updatedAt
    }));
  const local = verificationJobs
    .filter((job) => isLive(job.status))
    .map((job): WorkActivityItem => ({
      id: `verification:${job.id}`,
      jobId: job.id,
      prKey: job.prKey,
      title: titleFor(job.prKey),
      kind: "Local test",
      targetTab: "overview",
      status: job.status as "queued" | "running",
      detail: job.statusMessage || job.command,
      updatedAt: job.updatedAt
    }));
  return [...fixes, ...analysis, ...local].sort((a, b) => statusPriority(b.status) - statusPriority(a.status) || b.updatedAt.localeCompare(a.updatedAt));
}

function statusPriority(status: "queued" | "running"): number {
  return status === "running" ? 1 : 0;
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
