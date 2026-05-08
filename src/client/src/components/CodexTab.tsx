import { AlertTriangle, CheckCircle2, GitPullRequest, Loader2, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FixJob, Job } from "../../../shared/types";
import { fixPipelineNode, fixProgress, fixSpecialistState } from "../fixHelpers";
import { cleanConsoleOutput } from "../verificationHelpers";
import { phaseLabel } from "./WorkActivityPanel";
import { PreparedDiff, parsePreparedDiffFiles } from "./PreparedDiff";
import { Badge, plural, relativeDate } from "./uiBits";
import "./codexVerification.css";

export function FixSection({
  jobs,
  analysisJobs,
  highlightedJobId,
  askingFixId,
  onStart,
  onAsk,
  onPush,
  onRetry,
  onCancel,
  onRefreshDiff
}: {
  jobs: FixJob[];
  analysisJobs?: Job[];
  highlightedJobId?: string;
  askingFixId?: string;
  onStart: (instructions?: string, baseJobId?: string, source?: string) => void;
  onAsk: (id: string, question: string) => void;
  onPush: (id: string) => void;
  onRetry: (id: string, instructions?: string) => void;
  onCancel: (id: string) => void;
  onRefreshDiff: (id: string) => void;
}) {
  const sortedJobs = [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latest = sortedJobs[0];
  const [instructions, setInstructions] = useState("");
  const [viewedJobId, setViewedJobId] = useState<string | undefined>(highlightedJobId);
  const visibleSession = sortedJobs.find((job) => job.id === (viewedJobId ?? highlightedJobId)) ?? latest;
  const preparedPreview =
    visibleSession?.status === "done" && Boolean(visibleSession.diff?.trim()) && !visibleSession.committed && !visibleSession.pushed
      ? visibleSession
      : undefined;
  const livePreview =
    visibleSession && (visibleSession.status === "queued" || visibleSession.status === "running") && visibleSession.diff?.trim()
      ? visibleSession
      : preparedPreview;
  const running = visibleSession?.status === "queued" || visibleSession?.status === "running";
  const canPush = Boolean(preparedPreview && !running);
  const passes = ["Research", "Implementation", "Tests/QA", "Docs", "Security", "Final review"];
  useEffect(() => {
    if (!highlightedJobId) return;
    setViewedJobId(highlightedJobId);
    window.setTimeout(() => {
      document.getElementById(`fix-session-${highlightedJobId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, [highlightedJobId]);
  return (
    <div className="fix-workspace">
      <section id={visibleSession ? `fix-session-${visibleSession.id}` : undefined} className={`summary-card fix-card ${visibleSession?.id === highlightedJobId ? "session-highlight" : ""}`}>
        <div className="insight-heading">
          <h3>Codex Fix Session</h3>
          {visibleSession && <Badge tone={visibleSession.status === "failed" ? "danger" : running ? "queue" : "added"}>{visibleSession.status}</Badge>}
        </div>
        <p>Step 1 prepares a patch in a temporary PR checkout using research, implementation, tests/QA, docs, security, and final review passes. Step 2 is only available after you inspect the diff.</p>
        {visibleSession && visibleSession.id !== latest?.id && (
          <p className="muted">Viewing an older Codex session selected from Tool activity. The latest session is {latest?.id.slice(0, 8)}.</p>
        )}
        {visibleSession && <FixSessionContext job={visibleSession} />}
        <FixPhaseStatus job={visibleSession} />
        {visibleSession && <QaFailureSummary job={visibleSession} />}
        <div className="specialist-passes" aria-label="Fix pipeline status">
          {passes.map((pass) => {
            const state = fixSpecialistState(visibleSession, pass);
            const node = fixPipelineNode(visibleSession, pass);
            return (
              <span key={pass} className={`pipeline-badge ${state}`} title={node?.message}>
                {state === "done" && <CheckCircle2 size={12} />}
                {state === "current" && <Loader2 size={12} className="spin" />}
                {(state === "waiting" || state === "failed") && <AlertTriangle size={12} />}
                <span>{pass}</span>
                {node?.attempts && node.attempts > 1 && <em>x{node.attempts}</em>}
              </span>
            );
          })}
        </div>
        <div className="fix-actions">
          <button disabled={running} onClick={() => onStart(instructions, undefined, "Fix tab")}>
            {running ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            {running ? visibleSession?.statusMessage ?? "Preparing" : "Prepare fix preview"}
          </button>
          <button disabled={!canPush} onClick={() => preparedPreview && onPush(preparedPreview.id)}>
            <GitPullRequest size={16} />
            Approve commit and push
          </button>
          <button className="danger" disabled={!visibleSession || !running} onClick={() => visibleSession && onCancel(visibleSession.id)}>
            <X size={16} />
            Cancel
          </button>
        </div>
        {visibleSession && (
          <FixResult
            job={visibleSession}
            instructions={instructions}
            sending={running}
            asking={askingFixId === visibleSession.id}
            onInstructionsChange={setInstructions}
            onAskQuestion={() => onAsk(visibleSession.id, instructions)}
            onSendFollowup={() => onStart(buildFixFollowupInstructions(instructions), visibleSession.id, `Fix follow-up / ${visibleSession.source ?? "previous session"}`)}
            onRetry={() => onRetry(visibleSession.id, instructions)}
          />
        )}
      </section>
      <AnalysisSessions jobs={analysisJobs ?? []} />
      {sortedJobs.length > 1 && (
        <section className="summary-card fix-session-list">
          <div className="insight-heading">
            <h3>Codex sessions</h3>
            <Badge tone="neutral">{sortedJobs.length}</Badge>
          </div>
          <div>
            {sortedJobs.map((job) => (
              <a
                key={job.id}
                href={`#fix-session-${job.id}`}
                className={job.id === visibleSession?.id ? "active" : ""}
                onClick={(event) => {
                  event.preventDefault();
                  setViewedJobId(job.id);
                  window.setTimeout(() => {
                    document.getElementById(`fix-session-${job.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 20);
                }}
              >
                <Badge tone={job.status === "failed" ? "danger" : job.status === "done" ? "added" : "queue"}>{job.status}</Badge>
                <strong>{job.id.slice(0, 8)}</strong>
                <span>{job.source ?? phaseLabel(job.phase ?? "codex")}</span>
                <em>{relativeDate(job.updatedAt)}</em>
              </a>
            ))}
          </div>
        </section>
      )}
      {livePreview?.diff?.trim() && (
        <section className="summary-card prepared-changes-card">
          <div className="panel-title">
            <h3>Prepared code changes</h3>
            <div className="inline-actions">
              {running && livePreview.id === latest?.id && <Badge tone="queue">live</Badge>}
              <Badge tone="neutral">{plural(parsePreparedDiffFiles(livePreview.diff).length, "file")}</Badge>
              <button type="button" onClick={() => onRefreshDiff(livePreview.id)}>
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
          </div>
          <PreparedDiff diff={livePreview.diff} />
        </section>
      )}
    </div>
  );
}

function AnalysisSessions({ jobs }: { jobs: Job[] }) {
  const sorted = [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (sorted.length === 0) return null;
  return (
    <section className="summary-card analysis-session-list">
      <div className="insight-heading">
        <h3>Analysis sessions</h3>
        <Badge tone="neutral">{sorted.length}</Badge>
      </div>
      <div className="analysis-session-grid">
        {sorted.slice(0, 6).map((job) => {
          const running = job.status === "queued" || job.status === "running";
          return (
            <article key={job.id} className={`analysis-session-row ${job.status}`}>
              <div>
                <Badge tone={job.status === "failed" ? "danger" : running ? "queue" : "added"}>{job.status}</Badge>
                <strong>{job.id.slice(0, 8)}</strong>
                <span>{relativeDate(job.updatedAt)}</span>
                {job.durationMs && <em>{Math.round(job.durationMs / 1000)}s</em>}
              </div>
              <p>
                {job.result?.summary ??
                  job.error ??
                  job.statusMessage ??
                  job.recoveryMessage ??
                  (running
                    ? job.mode === "fast"
                      ? "MNLens is estimating queue score from PR metadata."
                      : "Codex is analyzing the PR and preparing review guidance."
                    : job.mode === "fast"
                      ? "Fast score analysis completed."
                      : "Analysis completed.")}
              </p>
              <AnalysisJobResult job={job} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AnalysisJobResult({ job }: { job: Job }) {
  const output = cleanConsoleOutput([job.error, job.stderr, job.stdout].filter(Boolean).join("\n\n"));
  const running = job.status === "queued" || job.status === "running";
  if (!output && !job.statusMessage && !job.recoveryMessage) return null;
  return (
    <div className={`verification-result analysis-result ${job.status === "done" ? "ok" : job.status === "failed" ? "failed" : "running"}`}>
      <div className="verification-result-status">
        <strong>{job.statusMessage ?? (running ? "Analysis running" : "Analysis session")}</strong>
        <span>{job.recoveryMessage ?? `Updated ${relativeDate(job.updatedAt)}`}</span>
      </div>
      {running && (
        <div className="verification-progress">
          <span style={{ width: job.status === "queued" ? "12%" : "58%" }} />
        </div>
      )}
      {output && (
        <details className="fix-result-log" open={job.status === "failed" || running}>
          <summary>Analysis session log</summary>
          <pre>{output}</pre>
        </details>
      )}
    </div>
  );
}

function QaFailureSummary({ job }: { job: FixJob }) {
  const failures = job.qaFailures ?? [];
  if (!job.qaSummary && failures.length === 0) return null;
  const qaNode = job.pipeline?.find((node) => node.phase === "tests-qa");
  return (
    <div className={`qa-summary-box ${qaNode?.status === "failed" ? "failed" : qaNode?.status === "waiting" ? "waiting" : ""}`}>
      <div>
        <strong>Tests/QA result</strong>
        {qaNode?.message && <Badge tone={qaNode.status === "failed" ? "danger" : qaNode.status === "waiting" ? "queue" : "neutral"}>{qaNode.status}</Badge>}
      </div>
      {job.qaSummary && <p>{job.qaSummary}</p>}
      {failures.length > 0 && (
        <details>
          <summary>{plural(failures.length, "verification failure")}</summary>
          <ul>
            {failures.slice(0, 4).map((failure, index) => (
              <li key={`${failure}-${index}`}>{failure}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FixSessionContext({ job }: { job: FixJob }) {
  const instructions = job.instructions?.trim();
  return (
    <div className="fix-session-context">
      <div>
        <span>Started from</span>
        <strong>
          {job.source ?? "Fix tab"}
          {job.baseJobId ? `, continuing ${job.baseJobId.slice(0, 8)}` : ""}
        </strong>
        {job.codexSessionId && <em>Codex session {job.codexSessionId}</em>}
      </div>
      <div>
        <span>Codex is trying to fix</span>
        <p>{instructions || "General review issues, existing PR comments, failing checks, and test gaps."}</p>
      </div>
    </div>
  );
}

function FixPhaseStatus({ job }: { job?: FixJob }) {
  const phase = fixPhaseInfo(job);
  return (
    <div className={`fix-phase-status ${phase.tone}`}>
      <div className="fix-phase-main">
        <span>{job?.id ? `Session ${job.id.slice(0, 8)}` : "No session yet"}</span>
        <strong>{phase.title}</strong>
        <p>{phase.detail}</p>
      </div>
      <div className="fix-phase-side">
        <Badge tone={phase.badgeTone}>{phase.phaseLabel}</Badge>
        <div className="verification-progress">
          <span style={{ width: phase.progress }} />
        </div>
      </div>
    </div>
  );
}

function fixPhaseInfo(job?: FixJob): {
  title: string;
  detail: string;
  phaseLabel: string;
  progress: string;
  tone: string;
  badgeTone: string;
} {
  if (!job) return { title: "Ready to prepare a fix", detail: "Codex will create a reviewable patch before anything is pushed.", phaseLabel: "idle", progress: "0%", tone: "idle", badgeTone: "neutral" };
  if (job.status === "failed" && job.resumable) {
    return {
      title: "Fix session interrupted",
      detail: job.recoveryMessage ?? job.statusMessage ?? "MNLens stopped while this session was active. Retry can continue from the preserved workspace/context.",
      phaseLabel: "resumable",
      progress: fixProgress(job.phase),
      tone: "failed",
      badgeTone: "queue"
    };
  }
  if (job.status === "failed") return { title: "Fix session failed", detail: job.statusMessage ?? "Open the log, adjust the prompt if needed, then retry the same session.", phaseLabel: "failed", progress: fixProgress(job.phase), tone: "failed", badgeTone: "danger" };
  if (job.status === "done" || job.phase === "completed") {
    return { title: job.pushed ? "Fix pushed" : job.committed ? "Fix committed locally" : "Fix preview ready", detail: job.statusMessage ?? "Review the prepared diff before approving any push.", phaseLabel: job.phase ?? "completed", progress: "100%", tone: "done", badgeTone: "added" };
  }
  const message = job.statusMessage ?? "Fix session is running.";
  if (job.phase === "preparing") return { title: "Workspace setup", detail: message, phaseLabel: "preparing", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  if (job.phase === "checking-out") return { title: "PR checkout", detail: message, phaseLabel: "checkout", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  if (job.phase === "research") return { title: "Research pass", detail: message, phaseLabel: "research", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  if (job.phase === "implementation") return { title: job.baseJobId ? "Implementation continuation" : "Implementation pass", detail: message, phaseLabel: "implementation", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  if (job.phase === "tests-qa") return { title: "Tests/QA pass", detail: message, phaseLabel: "tests/QA", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  if (job.phase === "docs") return { title: "Docs pass", detail: message, phaseLabel: "docs", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  if (job.phase === "security") return { title: "Security pass", detail: message, phaseLabel: "security", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  if (job.phase === "final-review") return { title: "Final review pass", detail: message, phaseLabel: "final review", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  if (job.phase === "codex") return { title: job.baseJobId ? "Codex continuation pass" : "Codex implementation pass", detail: `${message} Active passes: research, implementation, tests/QA, docs, security, final review.`, phaseLabel: "codex", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  if (job.phase === "testing") return { title: "Local verification", detail: message, phaseLabel: "tests/QA", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  if (job.phase === "committing") return { title: "Commit preparation", detail: message, phaseLabel: "commit", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  if (job.phase === "pushing") return { title: "Pushing approved fix", detail: message, phaseLabel: "push", progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
  return { title: job.status === "queued" ? "Queued" : "Running", detail: message, phaseLabel: job.phase ?? job.status, progress: fixProgress(job.phase), tone: "running", badgeTone: "queue" };
}

function buildFixFollowupInstructions(instructions: string): string {
  return `Continue the existing Codex Fix Session and reuse the current checkout. Do not start from a clean clone unless the existing worktree is unavailable.

Human follow-up:
${instructions.trim()}`;
}

function FixResult({
  job,
  instructions,
  sending,
  asking,
  onInstructionsChange,
  onAskQuestion,
  onSendFollowup,
  onRetry
}: {
  job: FixJob;
  instructions: string;
  sending: boolean;
  asking: boolean;
  onInstructionsChange: (value: string) => void;
  onAskQuestion: () => void;
  onSendFollowup: () => void;
  onRetry: () => void;
}) {
  const output = cleanConsoleOutput([job.error, job.stderr, job.stdout].filter(Boolean).join("\n\n"));
  const phase = fixPhaseInfo(job);
  return (
    <div className={`verification-result fix-result ${job.status === "done" ? "ok" : job.status === "failed" ? "failed" : "running"}`}>
      <div className="fix-result-header">
        <strong>{phase.title}{job.commitSha ? `, ${job.commitSha}` : ""}</strong>
        <small>{job.statusMessage ?? phase.detail}</small>
        {job.resumable && <small>{job.recoveryMessage ?? "This session can be retried from preserved context."}</small>}
        <span>{relativeDate(job.updatedAt)}</span>
        {job.repoDir && <em>{job.repoDir}</em>}
      </div>
      {(job.status === "queued" || job.status === "running") && (
        <div className="verification-progress fix-result-progress">
          <span style={{ width: fixProgress(job.phase) }} />
        </div>
      )}
      {job.conversation && job.conversation.length > 0 && (
        <div className="fix-conversation">
          <strong>Fix session Q&A</strong>
          {job.conversation.slice(-6).map((message) => (
            <article key={message.id} className={message.role}>
              <span>{message.role === "user" ? "You" : "Codex"} · {relativeDate(message.createdAt)}</span>
              <p>{message.body}</p>
            </article>
          ))}
        </div>
      )}
      {output && (
        <details className="fix-result-log" open>
          <summary>Fix session log</summary>
          <pre>{output}</pre>
          <div className="fix-log-followup">
            <label>
              {sending ? "Queue guidance for the next Codex pass" : "Ask a question or request code changes"}
              <textarea
                value={instructions}
                onChange={(event) => onInstructionsChange(event.target.value)}
                placeholder={sending ? "Codex is already running. Add guidance here and queue it for the next continuation pass." : "Ask for an explanation without changing code, or request a code change as a new preview."}
              />
            </label>
            <div className="fix-log-followup-actions">
              {job.status === "failed" && (
                <button disabled={sending} onClick={onRetry}>
                  {sending ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                  Retry session
                </button>
              )}
              <button disabled={asking || instructions.trim().length === 0} onClick={onAskQuestion}>
                <Send size={16} />
                {asking ? "Asking" : sending ? "Queue guidance" : "Ask Codex"}
              </button>
              <button disabled={asking || instructions.trim().length === 0} onClick={onSendFollowup}>
                <Sparkles size={16} />
                {sending ? "Queue code changes" : "Request changes"}
              </button>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
