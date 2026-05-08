import { CheckCircle2, FileSearch, GitPullRequest, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CiCheck, EditorKind, ManualVerificationResult, PrDetail, ReviewProgress, VerificationJob } from "../../../shared/types";
import { askCiFailure } from "../api";
import {
  automationReason,
  ciCoverageForCommand,
  ciSummary,
  cleanConsoleOutput,
  commandKey,
  extractRunnableCommand,
  isDocRenderVerificationItem,
  isGenuineManualVerification,
  isVulnerabilityAuditCheck,
  manualCheckId,
  manualVerificationCommand,
  sortCiChecks,
  sortVerificationItems,
  toneForCi,
  verificationProgress
} from "../verificationHelpers";
import { Badge, relativeDate } from "./uiBits";
import "./codexVerification.css";

export function VerificationSection({
  items,
  jobs,
  ciChecks,
  progress,
  compact,
  openingEditor,
  onRun,
  onRunManual,
  onOpenEditor,
  onStartFix,
  onSaveProgress
}: {
  items: string[];
  jobs: VerificationJob[];
  ciChecks: CiCheck[];
  progress?: ReviewProgress;
  compact: boolean;
  openingEditor?: EditorKind;
  onRun: (command: string) => void;
  onRunManual: (item: string, id: string) => void;
  onOpenEditor: (editor: EditorKind) => void;
  onStartFix: (instructions?: string, baseJobId?: string, source?: string) => void;
  onSaveProgress: (patch: Partial<Pick<ReviewProgress, "manualChecks">>) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const sortedItems = sortVerificationItems(items, jobs, progress);
  const visible = compact && !showAll ? sortedItems.slice(0, 2) : sortedItems;
  const hiddenCount = sortedItems.length - visible.length;
  const latestByCommand = new Map<string, VerificationJob>();
  for (const job of [...jobs].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    latestByCommand.set(commandKey(job.command), job);
  }
  return (
    <section className="summary-card insight-section tests">
      <div className="insight-heading">
        <h3>Tests To Check</h3>
        <div className="verification-heading-actions">
          {hiddenCount > 0 && (
            <button className="text-button" onClick={() => setShowAll(true)}>
              +{hiddenCount} more
            </button>
          )}
          {showAll && compact && sortedItems.length > 2 && (
            <button className="text-button" onClick={() => setShowAll(false)}>
              Show less
            </button>
          )}
          <button disabled={Boolean(openingEditor)} onClick={() => onOpenEditor("intellij")}>
            {openingEditor === "intellij" ? <Loader2 size={14} className="spin" /> : <FileSearch size={14} />}
            Open PR in IntelliJ
          </button>
          <button disabled={Boolean(openingEditor)} onClick={() => onOpenEditor("vscode")}>
            {openingEditor === "vscode" ? <Loader2 size={14} className="spin" /> : <FileSearch size={14} />}
            Open PR in VS Code
          </button>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="muted">No test guidance yet.</p>
      ) : (
        <div className="verification-list">
          {visible.map(({ item, originalIndex }, index) => {
            const command = extractRunnableCommand(item);
            const job = command ? latestByCommand.get(commandKey(command)) : undefined;
            const ciCoverage = command ? ciCoverageForCommand(command, ciChecks) : undefined;
            const manualId = manualCheckId(item, originalIndex);
            const manualCheck = progress?.manualChecks?.[manualId];
            const manualJob = command ? undefined : latestByCommand.get(commandKey(manualVerificationCommand(manualId)));
            const genuinelyManual = !command && isGenuineManualVerification(item);
            return (
              <article key={`${item}-${originalIndex}`} className="verification-item">
                <div>
                  <span>{index + 1}</span>
                  <p>{item}</p>
                </div>
                {command ? (
                  <button className="verification-action" disabled={job?.status === "queued" || job?.status === "running"} onClick={() => onRun(command)}>
                    {job?.status === "queued" || job?.status === "running" ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                    {job?.status === "queued" || job?.status === "running" ? job.statusMessage ?? "Running" : "Run locally"}
                  </button>
                ) : genuinelyManual ? (
                  <ManualVerificationControl
                    id={manualId}
                    item={item}
                    result={manualCheck}
                    job={manualJob}
                    progress={progress}
                    onRunManual={onRunManual}
                    onSaveProgress={onSaveProgress}
                  />
                ) : (
                  <AutomationVerificationControl
                    item={item}
                    job={manualJob}
                    onAskCodex={() => onRunManual(item, manualId)}
                    onStartFix={() => onStartFix(buildAutomationTestInstructions(item), undefined, "Overview / Tests To Check")}
                  />
                )}
                {ciCoverage && (
                  <div className={`ci-inline ${ciCoverage.bucket}`}>
                    <strong>CI: {ciCoverage.label}</strong>
                    <span>{ciCoverage.detail}</span>
                  </div>
                )}
                {job && <VerificationResult job={job} />}
                {manualJob && <VerificationResult job={manualJob} />}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function CiStatusSection({
  checks,
  detail,
  logs,
  loading,
  onFetchLog,
  onStartFix
}: {
  checks: CiCheck[];
  detail: PrDetail;
  logs: Record<string, string>;
  loading: Record<string, boolean>;
  onFetchLog: (check: CiCheck) => void;
  onStartFix: (instructions?: string, baseJobId?: string, source?: string) => void;
}) {
  const summary = ciSummary(checks);
  const sortedChecks = sortCiChecks(checks);
  const [ciAnswers, setCiAnswers] = useState<Record<string, string>>({});
  const [ciAnswerLoading, setCiAnswerLoading] = useState<Record<string, boolean>>({});
  const [ciAnswerErrors, setCiAnswerErrors] = useState<Record<string, string>>({});

  async function explain(check: CiCheck) {
    const key = check.link || check.name;
    setCiAnswerLoading((current) => ({ ...current, [key]: true }));
    setCiAnswerErrors((current) => ({ ...current, [key]: "" }));
    try {
      const response = await askCiFailure({
        owner: detail.owner,
        repo: detail.repo,
        number: detail.number,
        check,
        log: logs[check.link]?.slice(-45_000)
      });
      setCiAnswers((current) => ({ ...current, [key]: response.answer }));
    } catch (err) {
      setCiAnswerErrors((current) => ({ ...current, [key]: messageOf(err) }));
    } finally {
      setCiAnswerLoading((current) => ({ ...current, [key]: false }));
    }
  }

  return (
    <section className="summary-card ci-section">
      <div className="insight-heading">
        <h3>CI Status</h3>
        <Badge tone={summary.tone}>{summary.label}</Badge>
      </div>
      {checks.length === 0 ? (
        <p className="muted">No CI checks found yet.</p>
      ) : (
        <div className="ci-list">
          {sortedChecks.map((check) => {
            const log = logs[check.link];
            const key = check.link || check.name;
            const failed = check.bucket === "fail" || /fail|error|cancel/i.test(check.state);
            return (
              <article className={`ci-check ${check.bucket || "neutral"}`} key={`${check.name}-${check.link}`}>
                <div>
                  <strong>{check.name}</strong>
                  <Badge tone={toneForCi(check)}>{check.state || check.bucket || "unknown"}</Badge>
                </div>
                <p>{[check.workflow, check.description].filter(Boolean).join(" - ") || "GitHub check"}</p>
                <span>{check.completedAt && !check.completedAt.startsWith("0001-") ? relativeDate(check.completedAt) : "no timestamp"}</span>
                <div className="ci-actions">
                  {check.link && (
                    <a className="button-like" href={check.link} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  )}
                  {check.canFetchLog && (
                    <button disabled={loading[check.link]} onClick={() => onFetchLog(check)}>
                      {loading[check.link] ? <Loader2 size={16} className="spin" /> : <FileSearch size={16} />}
                      {checkRunDetailsAvailable(check) ? "Fetch details" : "Fetch logs"}
                    </button>
                  )}
                  {failed && (
                    <>
                      <button disabled={ciAnswerLoading[key]} onClick={() => void explain(check)}>
                        {ciAnswerLoading[key] ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                        Explain failure
                      </button>
                      <button
                        onClick={() =>
                          onStartFix(
                            buildCiFixInstructions(check, {
                              fetchedDetails: log,
                              explanation: ciAnswers[key],
                              explanationError: ciAnswerErrors[key]
                            }),
                            undefined,
                            `Overview / CI Status / ${check.name}`
                          )
                        }
                      >
                        <GitPullRequest size={16} />
                        Address with Codex
                      </button>
                    </>
                  )}
                </div>
                {(ciAnswers[key] || ciAnswerErrors[key]) && (
                  <div className={`ci-explanation ${ciAnswerErrors[key] ? "error-text" : ""}`}>
                    <MarkdownBody body={ciAnswerErrors[key] || ciAnswers[key]} />
                  </div>
                )}
                {!check.canFetchLog && failed && (
                  <p className="muted">{ciLogUnavailableReason(check)}</p>
                )}
                {log && (
                  <details open>
                    <summary>CI log</summary>
                    <pre>{cleanConsoleOutput(log)}</pre>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function VerificationResult({ job }: { job: VerificationJob }) {
  const ok = job.status === "done";
  const failed = job.status === "failed";
  const output = cleanConsoleOutput([job.error, job.stderr, job.stdout].filter(Boolean).join("\n\n"));
  const shouldShowOutput = Boolean(output) || job.status === "queued" || job.status === "running";
  return (
    <div className={`verification-result ${ok ? "ok" : failed ? "failed" : "running"}`}>
      <div className="verification-result-status">
        <strong>
          Latest run:{" "}
          {job.statusMessage ?? job.status}
          {typeof job.exitCode === "number" ? `, exit ${job.exitCode}` : ""}
          {job.durationMs ? `, ${Math.round(job.durationMs / 1000)}s` : ""}
        </strong>
        {job.resumable && <small>{job.recoveryMessage ?? "Interrupted after restart. Run this check again to continue."}</small>}
        <span>{relativeDate(job.updatedAt)}</span>
      </div>
      <div className="verification-result-command">
        <code>{job.command}</code>
      </div>
      {(job.status === "queued" || job.status === "running") && (
        <div className="verification-progress">
          <span style={{ width: verificationProgress(job.phase) }} />
        </div>
      )}
      {job.repoDir && (
        <div className="verification-result-workspace">
          <em>{job.repoDir}</em>
        </div>
      )}
      {job.artifacts && job.artifacts.length > 0 && (
        <div className="verification-artifacts">
          <strong>Review artifacts</strong>
          {job.artifacts.map((artifact) => (
            <a
              key={`${artifact.kind}-${artifact.path}`}
              className={`artifact-link ${artifact.kind}`}
              href={artifact.url ?? `/api/artifacts?path=${encodeURIComponent(artifact.path)}`}
              target="_blank"
              rel="noreferrer"
              title={artifact.path}
            >
              <span>{artifactActionLabel(artifact.kind)}</span>
              <em>{artifact.label}</em>
            </a>
          ))}
        </div>
      )}
      {shouldShowOutput && (
        <details className="verification-result-output" open>
          <summary>Output</summary>
          <pre>{output || "Waiting for output..."}</pre>
        </details>
      )}
    </div>
  );
}

function ManualVerificationControl({
  id,
  item,
  result,
  job,
  progress,
  onRunManual,
  onSaveProgress
}: {
  id: string;
  item: string;
  result?: ManualVerificationResult;
  job?: VerificationJob;
  progress?: ReviewProgress;
  onRunManual: (item: string, id: string) => void;
  onSaveProgress: (patch: Partial<Pick<ReviewProgress, "manualChecks">>) => void;
}) {
  const [note, setNote] = useState(result?.note ?? "");
  const [collapsed, setCollapsed] = useState(() => result?.status === "passed");
  const docRenderCheck = isDocRenderVerificationItem(item);

  useEffect(() => {
    setNote(result?.note ?? "");
  }, [result?.note]);

  function save(status: ManualVerificationResult["status"]) {
    setCollapsed(status === "passed");
    onSaveProgress({
      manualChecks: {
        ...(progress?.manualChecks ?? {}),
        [id]: {
          item,
          status,
          note: note.trim(),
          updatedAt: new Date().toISOString()
        }
      }
    });
  }

  if (result?.status === "passed" && collapsed) {
    return (
      <div className="manual-check compact passed">
        <div>
          <Badge tone="added">{docRenderCheck ? "docs verified" : "manual passed"}</Badge>
          <span>{relativeDate(result.updatedAt)}</span>
        </div>
        {result.note && <p>{result.note}</p>}
        <button className="text-button" onClick={() => setCollapsed(false)}>
          Show details
        </button>
      </div>
    );
  }

  return (
    <div className={`manual-check ${result?.status ?? "pending"}`}>
      <div>
        <Badge tone={result?.status === "passed" ? "added" : result?.status === "failed" ? "danger" : "neutral"}>
          {result?.status === "passed"
            ? docRenderCheck
              ? "docs verified"
              : "manual passed"
            : result?.status === "failed"
              ? docRenderCheck
                ? "docs follow-up"
                : "manual follow-up"
              : docRenderCheck
                ? "docs render check"
                : "manual check"}
        </Badge>
        {result && <span>{relativeDate(result.updatedAt)}</span>}
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Record what you checked, commands tried elsewhere, screenshots, or why this needs follow-up."
      />
      <div className="manual-actions">
        <button disabled={job?.status === "queued" || job?.status === "running"} onClick={() => onRunManual(item, id)}>
          {job?.status === "queued" || job?.status === "running" ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
          {docRenderCheck ? "Build docs + screenshot" : "Ask Codex"}
        </button>
        <button onClick={() => save("passed")}>
          <CheckCircle2 size={16} />
          Mark passed
        </button>
        <button className="danger" onClick={() => save("failed")}>
          <ShieldAlert size={16} />
          Needs follow-up
        </button>
      </div>
    </div>
  );
}

function AutomationVerificationControl({
  item,
  job,
  onAskCodex,
  onStartFix
}: {
  item: string;
  job?: VerificationJob;
  onAskCodex: () => void;
  onStartFix: () => void;
}) {
  return (
    <div className="automation-check">
      <div>
        <Badge tone="improvement">automation candidate</Badge>
        <span>Prefer adding a runnable test/TCK check instead of leaving this as reviewer memory.</span>
      </div>
      <div className="manual-actions">
        <button disabled={job?.status === "queued" || job?.status === "running"} onClick={onAskCodex}>
          {job?.status === "queued" || job?.status === "running" ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
          Ask Codex how to verify
        </button>
        <button onClick={onStartFix}>
          <CheckCircle2 size={16} />
          Add automated test
        </button>
      </div>
      <p className="muted">{automationReason(item)}</p>
    </div>
  );
}

function buildAutomationTestInstructions(item: string): string {
  return `Improve PR verification by replacing this manual review item with automated coverage.

Test item:
${item}

Add or update the smallest appropriate automated test, integration test, or TCK-style module/check that proves this behavior. Prefer project conventions and existing test infrastructure. If this truly cannot be automated locally, explain why and add the closest practical automated guard.`;
}

function buildCiFixInstructions(
  check: CiCheck,
  context: { fetchedDetails?: string; explanation?: string; explanationError?: string } = {}
): string {
  const fetchedDetails = context.fetchedDetails?.trim()
    ? cleanConsoleOutput(context.fetchedDetails).slice(-18_000)
    : check.details?.trim()
      ? cleanConsoleOutput(check.details).slice(-18_000)
      : "";
  const detailLabel = context.fetchedDetails?.trim() ? "Fetched CI/check details" : check.details?.trim() ? "Loaded CI/check details" : "CI/check details";
  const explanation = context.explanation?.trim()
    ? context.explanation.trim()
    : context.explanationError?.trim()
      ? `Explain failure was attempted but failed in MNLens:\n${context.explanationError.trim()}`
      : "";
  const detailBlock = fetchedDetails || "No CI log/check details were fetched in the app yet. Use the check metadata and link if exact provider output is needed.";
  const explanationBlock = explanation || "No prior MNLens explanation was generated for this check.";
  const vulnerabilityGuidance = isVulnerabilityAuditCheck(check)
    ? `\nVulnerability Audit dependency policy:\n- First identify the vulnerable module and the dependency path that brings it in. Use dependency insight/tree tasks where possible.\n- Prefer updating the root dependency that owns the vulnerable transitive dependency. For example, if a Netty CVE is introduced through Micronaut Core, first try updating the Micronaut Core/Micronaut platform version.\n- Do not add a direct forced version or dependency constraint just because it makes the audit pass.\n- Only introduce a direct fixed version/constraint as a last resort, and explain why the root dependency cannot be updated safely in this PR.\n`
    : "";
  return `Investigate and fix this failing CI check in the smallest coherent patch.

CI check:
- Name: ${check.name}
- Workflow: ${check.workflow || "unknown"}
- State: ${check.state || "unknown"}
- Description: ${check.description || "none"}
- Link: ${check.link || "none"}

Use the CI/check context below to identify the failure. It includes any details fetched in MNLens and any prior Explain failure answer. If the failure is unrelated or flaky, do not make speculative code changes; leave a concise explanation in the fix session log.
${vulnerabilityGuidance}

${detailLabel}:
${detailBlock}

Prior MNLens explanation:
${explanationBlock}`;
}

function ciLogUnavailableReason(check: CiCheck): string {
  const text = `${check.name} ${check.workflow} ${check.description} ${check.link}`.toLowerCase();
  if (text.includes("sonar")) {
    return "SonarCloud is an external check, not a GitHub Actions job, so MNLens cannot download an Actions log for it. Open the check or use Explain failure; Codex will reason from the SonarCloud metadata/link unless Sonar details are available in the browser.";
  }
  return "Logs are only downloadable for GitHub Actions job links. This check appears to be external or summary-only, so open the check for provider-specific output.";
}

function checkRunDetailsAvailable(check: CiCheck): boolean {
  return /[?&]check_run_id=\d+/.test(check.link) || /\/runs\/\d+/.test(check.link);
}

function artifactActionLabel(kind: NonNullable<VerificationJob["artifacts"]>[number]["kind"]): string {
  if (kind === "screenshot") return "Open screenshot";
  if (kind === "html") return "Open rendered docs";
  if (kind === "log") return "Open log";
  if (kind === "diff") return "Open diff";
  if (kind === "json") return "Open JSON";
  return "Open artifact";
}

function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
