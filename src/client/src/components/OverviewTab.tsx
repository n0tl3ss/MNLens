import { Bug, FolderKanban, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { AnalysisResult, CiCheck, FixJob, GithubProject, PrDetail, RepoReviewRule, ReviewInsight, ReviewProgress, VerificationJob } from "../../../shared/types";
import { fixCurrentSpecialist } from "../fixHelpers";
import { insightScope, isDocsOnlyReview, latestPushedFix, sourceChangedLines } from "../reviewHelpers";
import { readinessForPr } from "../reviewScoring";
import {
  ciSummary,
  extractRunnableCommand,
  isAutomationVerificationCandidate,
  isGenuineManualVerification,
  isVulnerabilityAuditCheck,
  manualCheckId,
  commandKey,
  toneForCi
} from "../verificationHelpers";
import { ReviewDeltaSection } from "./ReviewDeltaSection";
import { FinalRecommendationSection, PrContextSection, type ReviewRecommendation } from "./OverviewSections";
import { ReadinessSection } from "./ReviewStatusCards";
import { InsightSection } from "./InsightSection";
import "./overviewTab.css";
import { TestAssessmentSection } from "./TestAssessmentSection";
import { CiStatusSection, VerificationSection } from "./VerificationPanel";
import type { DraftReviewComment } from "./CommentTab";
import { Badge, plural } from "./uiBits";

export function OverviewTab({
  analysis,
  attentionMode,
  canApproveWithoutComments,
  ciChecks,
  ciLoading,
  ciLogs,
  detail,
  fixJobs,
  openingEditor,
  progress,
  githubProjects,
  githubProjectsError,
  projectAttachBusy,
  recommendation,
  repoRules,
  reviewComments,
  verificationJobs,
  onAddRepoRule,
  onFetchCiLog,
  onOpenEditor,
  onRunManualVerification,
  onRunVerification,
  onSaveProgress,
  onAttachGithubProject,
  onSetRepoRuleEnabled,
  onStartFix
}: {
  analysis?: AnalysisResult;
  attentionMode: boolean;
  canApproveWithoutComments: boolean;
  ciChecks: CiCheck[];
  ciLoading: Record<string, boolean>;
  ciLogs: Record<string, string>;
  detail: PrDetail;
  fixJobs: FixJob[];
  openingEditor?: "intellij" | "vscode";
  progress?: ReviewProgress;
  githubProjects: GithubProject[];
  githubProjectsError?: string;
  projectAttachBusy: boolean;
  recommendation: ReviewRecommendation;
  repoRules: RepoReviewRule[];
  reviewComments: DraftReviewComment[];
  verificationJobs: VerificationJob[];
  onAddRepoRule: (rule: { title: string; body: string; tone?: string; source?: string }) => void;
  onFetchCiLog: (check: CiCheck) => void;
  onOpenEditor: (editor: "intellij" | "vscode") => void;
  onRunManualVerification: (item: string, id: string) => void;
  onRunVerification: (command: string) => void;
  onSaveProgress: (patch: Partial<Pick<ReviewProgress, "checkedItems" | "reviewedFiles" | "ignoredRuleIds" | "manualChecks" | "project" | "issueProjects" | "notes" | "lastReviewedAt">>) => void;
  onAttachGithubProject: (projectId: string, includeLinkedIssues: boolean) => void;
  onSetRepoRuleEnabled: (id: string, enabled: boolean) => void;
  onStartFix: (instructions?: string, baseJobId?: string, source?: string) => void;
}) {
  const reviewerFocusDetails = mergeReviewerFocusDetails(detail, analysis, attentionMode);
  return (
    <div className="panel overview-panel">
      <FinalRecommendationSection recommendation={recommendation} />
      <PrContextSection detail={detail} progress={progress} />
      <ProjectAssignmentSection
        detail={detail}
        progress={progress}
        githubProjects={githubProjects}
        githubProjectsError={githubProjectsError}
        projectAttachBusy={projectAttachBusy}
        onAttachGithubProject={onAttachGithubProject}
      />
      <ReadinessSection
        readiness={readinessForPr(detail, {
          detail,
          analysis,
          progress,
          ciChecks,
          verificationJobs,
          draftComments: reviewComments,
          canApproveWithoutComments
        })}
      />
      <ReviewDeltaSection
        detail={detail}
        progress={progress}
        ciChecks={ciChecks}
        verificationJobs={verificationJobs}
        fixJobs={fixJobs}
        onMarkReviewed={() => onSaveProgress({ lastReviewedAt: new Date().toISOString() })}
      />
      {attentionMode && (
        <AttentionPanel
          detail={detail}
          analysis={analysis}
          progress={progress}
          ciChecks={ciChecks}
          verificationJobs={verificationJobs}
          draftComments={reviewComments}
        />
      )}
      <div className="overview-grid">
        {!attentionMode && (
          <>
            <section className="summary-card overview-summary-card">
              <div className="panel-title">
                <h3>Review Summary</h3>
                <Bug size={18} />
              </div>
              <p>{analysis?.summary ?? "Analyze this PR to classify it and generate reviewer guidance."}</p>
              {analysis?.behaviorBefore && <Callout title="Before" text={analysis.behaviorBefore} />}
              {analysis?.behaviorAfter && <Callout title="After" text={analysis.behaviorAfter} />}
            </section>
            <PolicySection
              detail={detail}
              analysis={analysis}
              progress={progress}
              repoRules={repoRules}
              ciChecks={ciChecks}
              verificationJobs={verificationJobs}
              fixJobs={fixJobs}
              onSaveProgress={onSaveProgress}
              onAddRepoRule={onAddRepoRule}
              onSetRepoRuleEnabled={onSetRepoRuleEnabled}
            />
          </>
        )}
        <div className="overview-columns">
          <div>
            {!attentionMode && (
              <InsightSection
                title="Evidence"
                tone="evidence"
                items={analysis?.evidence ?? detail.labels.map((label) => `GitHub label: ${label}`)}
                details={analysis?.evidenceDetails ?? []}
                compact={attentionMode}
                progress={progress}
                onSaveProgress={onSaveProgress}
              />
            )}
            <InsightSection
              title="Reviewer Focus"
              tone="focus"
              items={analysis?.reviewerFocus ?? []}
              details={reviewerFocusDetails}
              compact={attentionMode}
              detail={detail}
              onStartFix={onStartFix}
              progress={progress}
              onSaveProgress={onSaveProgress}
            />
            {(!attentionMode || analysis?.testAssessment?.rating === "weak" || analysis?.testAssessment?.rating === "partial") && (
              <TestAssessmentSection assessment={analysis?.testAssessment} onImproveTests={(instructions) => onStartFix(instructions, undefined, "Overview / Test Quality")} />
            )}
            <CiStatusSection checks={ciChecks} detail={detail} logs={ciLogs} loading={ciLoading} onFetchLog={onFetchCiLog} onStartFix={onStartFix} />
          </div>
          <div>
            <InsightSection
              title="Risks"
              tone="risk"
              items={analysis?.risks ?? []}
              details={attentionMode ? importantInsights(analysis?.riskDetails ?? []) : (analysis?.riskDetails ?? [])}
              compact={attentionMode}
              detail={detail}
              onStartFix={onStartFix}
              progress={progress}
              onSaveProgress={onSaveProgress}
            />
            <VerificationSection
              items={analysis?.testsToCheck ?? []}
              jobs={verificationJobs}
              ciChecks={ciChecks}
              progress={progress}
              compact={attentionMode}
              openingEditor={openingEditor}
              onRun={onRunVerification}
              onRunManual={onRunManualVerification}
              onOpenEditor={onOpenEditor}
              onStartFix={onStartFix}
              onSaveProgress={onSaveProgress}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function mergeReviewerFocusDetails(detail: PrDetail, analysis: AnalysisResult | undefined, attentionMode: boolean): ReviewInsight[] {
  const base = attentionMode ? importantInsights(analysis?.reviewerFocusDetails ?? []) : (analysis?.reviewerFocusDetails ?? []);
  const existing = new Set(base.map((item) => `${item.title ?? ""}\n${item.observation}`.toLowerCase()));
  const comments = detail.reviewComments
    .filter((comment) => comment.isResolved !== true)
    .filter((comment) => comment.isResolved === false || comment.line !== undefined)
    .map((comment): ReviewInsight => {
      const line = comment.line ?? comment.originalLine;
      const location = `${comment.path}${line ? `:${line}` : ""}`;
      return {
        title: `${comment.isResolved === false ? "Unresolved" : "Current"} line comment: ${location}`,
        observation: comment.body,
        perspective: `Existing GitHub review comment by ${comment.author}${line ? ` on ${location}` : ` on ${comment.path}`}.`,
        recommendation: `Inspect the changed code at ${location}. If the reviewer suggestion is valid, address it in the smallest patch and add/update focused tests when behavior changes. If it is not valid, leave a concise explanation in the Codex session log.`,
        severity: commentSeverity(comment.body)
      };
    })
    .filter((item) => {
      const key = `${item.title ?? ""}\n${item.observation}`.toLowerCase();
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
  return [...comments, ...base];
}

function commentSeverity(body: string): ReviewInsight["severity"] {
  const text = body.toLowerCase();
  if (/\b(bug|broken|incorrect|fail|failing|regression|security|unsafe|must|block|leak)\b/.test(text)) return "high";
  if (/\b(can this|should|please|remove|add|missing|test|why|verify|use)\b/.test(text)) return "medium";
  return "low";
}

function ProjectAssignmentSection({
  detail,
  progress,
  githubProjects,
  githubProjectsError,
  projectAttachBusy,
  onAttachGithubProject
}: {
  detail: PrDetail;
  progress?: ReviewProgress;
  githubProjects: GithubProject[];
  githubProjectsError?: string;
  projectAttachBusy: boolean;
  onAttachGithubProject: (projectId: string, includeLinkedIssues: boolean) => void;
}) {
  const currentProject = progress?.project?.trim() ?? "";
  const [githubProjectId, setGithubProjectId] = useState("");
  const [includeLinkedIssues, setIncludeLinkedIssues] = useState(true);

  return (
    <section className="summary-card project-assignment-card">
      <div className="panel-title">
        <div>
          <h3>GitHub Project</h3>
          <p className="muted">Attach this PR and its linked issues to an organization Project.</p>
        </div>
        <Badge tone={currentProject ? "added" : "neutral"}>{currentProject || "Unassigned"}</Badge>
      </div>
      <div className="project-assignment-controls github-project-controls">
        <label>
          <span>GitHub Organization Project</span>
          <select value={githubProjectId} onChange={(event) => setGithubProjectId(event.target.value)}>
            <option value="">{githubProjects.length > 0 ? "Choose organization project" : "No organization projects found"}</option>
            {githubProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}{project.ownerType === "user" ? " (user)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="check-control project-issue-sync">
          <input type="checkbox" checked={includeLinkedIssues} onChange={(event) => setIncludeLinkedIssues(event.target.checked)} />
          Include linked issues
        </label>
        <button type="button" disabled={!githubProjectId || projectAttachBusy} onClick={() => onAttachGithubProject(githubProjectId, includeLinkedIssues)}>
          <FolderKanban size={14} />
          {projectAttachBusy ? "Attaching..." : "Attach on GitHub"}
        </button>
      </div>
      {githubProjectsError && (
        <p className="project-assignment-error">
          Could not list organization projects. Add classic <code>read:project</code>/<code>project</code> scopes, or fine-grained Projects read/write access, then refresh GitHub auth.
        </p>
      )}
    </section>
  );
}

function AttentionPanel({
  detail,
  analysis,
  progress,
  ciChecks,
  verificationJobs,
  draftComments
}: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  progress?: ReviewProgress;
  ciChecks: CiCheck[];
  verificationJobs: VerificationJob[];
  draftComments: DraftReviewComment[];
}) {
  const items = attentionItems(detail, analysis, progress, ciChecks, verificationJobs, draftComments);
  return (
    <section className="summary-card attention-card">
      <div className="panel-title">
        <div>
          <h3>Attention Mode</h3>
          <p className="muted">Only the highest-value review work is shown below.</p>
        </div>
        <Badge tone={items.some((item) => item.tone === "danger") ? "danger" : items.some((item) => item.tone === "queue") ? "queue" : "added"}>
          {items.length} signals
        </Badge>
      </div>
      <div className="attention-list">
        {items.map((item) => (
          <article key={item.title} className={item.tone}>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PolicySection({
  detail,
  analysis,
  progress,
  repoRules,
  ciChecks,
  verificationJobs,
  fixJobs,
  onSaveProgress,
  onAddRepoRule,
  onSetRepoRuleEnabled
}: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  progress?: ReviewProgress;
  repoRules: RepoReviewRule[];
  ciChecks: CiCheck[];
  verificationJobs: VerificationJob[];
  fixJobs: FixJob[];
  onSaveProgress: (patch: Partial<Pick<ReviewProgress, "checkedItems" | "ignoredRuleIds">>) => void;
  onAddRepoRule: (rule: { title: string; body: string; tone?: string; source?: string }) => void;
  onSetRepoRuleEnabled: (id: string, enabled: boolean) => void;
}) {
  const policies = reviewPolicies(detail, analysis, ciChecks, repoRules);
  const checked = new Set(progress?.checkedItems ?? []);
  const ignored = new Set(progress?.ignoredRuleIds ?? []);
  const suggestedRules = outcomeAwareRuleSuggestions(detail, analysis, ciChecks, verificationJobs, fixJobs).filter((rule) => !policies.items.some((item) => item.title === rule.title));
  const [selectedLearning, setSelectedLearning] = useState<Record<string, boolean>>({});
  const [savedLearning, setSavedLearning] = useState<Record<string, boolean>>({});
  const selectedLearningCount = suggestedRules.filter((rule) => selectedLearning[rule.title] ?? true).length;

  useEffect(() => {
    const visible = new Set(suggestedRules.map((rule) => rule.title));
    setSelectedLearning((current) => {
      const next: Record<string, boolean> = {};
      for (const rule of suggestedRules) next[rule.title] = current[rule.title] ?? true;
      for (const [title, value] of Object.entries(current)) {
        if (visible.has(title)) next[title] = value;
      }
      return next;
    });
  }, [suggestedRules.map((rule) => rule.title).join("\u0000")]);

  function toggle(id: string) {
    onSaveProgress({
      checkedItems: checked.has(id) ? (progress?.checkedItems ?? []).filter((item) => item !== id) : [...(progress?.checkedItems ?? []), id]
    });
  }

  function toggleIgnored(id: string) {
    onSaveProgress({
      ignoredRuleIds: ignored.has(id) ? (progress?.ignoredRuleIds ?? []).filter((item) => item !== id) : [...(progress?.ignoredRuleIds ?? []), id]
    });
  }

  function toggleLearning(title: string) {
    setSelectedLearning((current) => ({ ...current, [title]: !(current[title] ?? true) }));
  }

  function saveSelectedLearning() {
    const toSave = suggestedRules.filter((rule) => (selectedLearning[rule.title] ?? true) && !savedLearning[rule.title]);
    for (const rule of toSave) onAddRepoRule({ ...rule, source: "review-outcome" });
    setSavedLearning((current) => ({ ...current, ...Object.fromEntries(toSave.map((rule) => [rule.title, true])) }));
  }

  return (
    <section className="summary-card policy-card">
      <div className="panel-title">
        <div>
          <h3>Repo Review Memory</h3>
          <p className="muted">Saved project rules plus generated checks. Ignore only when this PR does not need the rule.</p>
        </div>
        <div className="inline-actions">
          <Badge tone="neutral">{policies.scope}</Badge>
          <Badge tone="added">{repoRules.filter((rule) => rule.enabled).length} saved</Badge>
        </div>
      </div>
      <div className="policy-list">
        {policies.items.map((item) => {
          const done = checked.has(item.id);
          const isIgnored = ignored.has(item.id);
          return (
            <label key={item.id} className={`${done ? "checked" : ""} ${isIgnored ? "ignored" : ""}`}>
              <input type="checkbox" checked={done} disabled={isIgnored} onChange={() => toggle(item.id)} />
              <span>
                <strong>{item.title}</strong>
                <em>{item.body}</em>
              </span>
              <span className="policy-actions">
                <Badge tone={item.tone}>{item.tone}</Badge>
                {item.source === "saved" && <Badge tone="added">memory</Badge>}
                <button type="button" onClick={() => toggleIgnored(item.id)}>{isIgnored ? "Use" : "Skip"}</button>
                {item.source === "saved" && <button type="button" onClick={() => onSetRepoRuleEnabled(item.id.replace(/^policy:/, ""), false)}>Disable</button>}
              </span>
            </label>
          );
        })}
      </div>
      {suggestedRules.length > 0 && (
        <div className="policy-suggestions outcome-learning">
          <div className="learning-header">
            <div>
              <strong>Learn from this review outcome</strong>
              <p>
                Use this near the end of a review. MNLens summarizes checks that were actually useful in this session; save only the ones that should become earlier repo memory for future PRs.
              </p>
            </div>
            <button type="button" disabled={selectedLearningCount === 0} onClick={saveSelectedLearning}>
              <Sparkles size={14} />
              Save selected
            </button>
          </div>
          <div className="learning-candidates">
            {suggestedRules.slice(0, 6).map((rule) => {
              const selected = selectedLearning[rule.title] ?? true;
              const saved = savedLearning[rule.title];
              return (
                <label key={rule.title} className={saved ? "saved" : ""}>
                  <input type="checkbox" checked={selected} disabled={saved} onChange={() => toggleLearning(rule.title)} />
                  <span>
                    <strong>{rule.title}</strong>
                    <em>{rule.body}</em>
                  </span>
                  <Badge tone={saved ? "added" : rule.tone}>{saved ? "saved" : "candidate"}</Badge>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function Callout({ title, text }: { title: string; text: string }) {
  const tone = title.toLowerCase();
  return (
    <div className={`callout ${tone}`}>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function importantInsights(items: ReviewInsight[]): ReviewInsight[] {
  return items.filter((item) => item.severity === "high" || item.severity === "medium").slice(0, 3);
}

function attentionItems(
  detail: PrDetail,
  analysis: AnalysisResult | undefined,
  progress: ReviewProgress | undefined,
  ciChecks: CiCheck[],
  verificationJobs: VerificationJob[],
  draftComments: DraftReviewComment[]
): Array<{ title: string; body: string; tone: string }> {
  const items: Array<{ title: string; body: string; tone: string }> = [];
  const highRisks = [...(analysis?.riskDetails ?? []), ...(analysis?.reviewerFocusDetails ?? [])]
    .filter((item) => item.severity === "high")
    .slice(0, 3);
  const failedChecks = ciChecks.filter((check) => toneForCi(check) === "danger").slice(0, 2);
  const failedLocal = verificationJobs.filter((job) => job.status === "failed" || (typeof job.exitCode === "number" && job.exitCode !== 0)).slice(0, 2);
  const pendingManual = analysis?.testsToCheck.filter((item, index) => isGenuineManualVerification(item) && !progress?.manualChecks?.[manualCheckId(item, index)]).length ?? 0;
  for (const item of highRisks) {
    items.push({ title: item.title, body: item.recommendation || item.perspective || item.observation, tone: toneForSeverity(item.severity) });
  }
  for (const check of failedChecks) {
    items.push({ title: `CI: ${check.name}`, body: check.description || check.state || "Failing check needs attention.", tone: "danger" });
  }
  for (const job of failedLocal) {
    items.push({ title: "Local verification failed", body: `${job.command}: ${job.error || job.statusMessage || `exit ${job.exitCode ?? "unknown"}`}`, tone: "danger" });
  }
  if (analysis?.testAssessment?.rating) {
    const testRating = analysis.testAssessment.rating;
    if (testRating === "weak" || testRating === "partial") {
      items.push({ title: `Test quality is ${testRating}`, body: analysis?.testAssessment?.summary ?? "Review whether changed behavior has enough test coverage.", tone: "queue" });
    }
  }
  if (pendingManual > 0) items.push({ title: "Manual checks open", body: `${pendingManual} manual verification item${pendingManual === 1 ? "" : "s"} still need a pass/follow-up decision.`, tone: "queue" });
  if (draftComments.some((comment) => comment.body.trim())) items.push({ title: "Draft review comments", body: "You have local comments that are not submitted to GitHub yet.", tone: "queue" });
  if (items.length === 0) {
    items.push({
      title: "No urgent blocker visible",
      body: isDocsOnlyReview(detail, detail, analysis) ? "Quick docs rendering and wording check should be enough." : "Skim source diff, tests, and CI before deciding.",
      tone: "added"
    });
  }
  return items;
}

function reviewPolicies(detail: PrDetail, analysis: AnalysisResult | undefined, ciChecks: CiCheck[], repoRules: RepoReviewRule[]): {
  scope: string;
  items: Array<{ id: string; title: string; body: string; tone: string; source: "generated" | "saved" }>;
} {
  const repo = detail.repository.toLowerCase();
  const text = `${detail.title} ${detail.body} ${detail.files.map((file) => file.path).join(" ")} ${(analysis?.summary ?? "")}`.toLowerCase();
  const items: Array<{ id: string; title: string; body: string; tone: string; source: "generated" | "saved" }> = [];
  const add = (title: string, body: string, tone = "queue") => {
    const id = `policy:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    if (!items.some((item) => item.id === id)) items.push({ id, title, body, tone, source: "generated" });
  };
  for (const rule of repoRules.filter((rule) => rule.enabled)) {
    items.push({ id: `policy:${rule.id}`, title: rule.title, body: rule.body, tone: rule.tone ?? "queue", source: "saved" });
  }
  if (repo.includes("micronaut")) {
    add("Micronaut lifecycle proof", "For bean/listener/configuration changes, verify enable/disable behavior and lifecycle cleanup are tested.", "queue");
    add("No copied configuration without purpose", "Question copied annotations or builders unless the exposed properties are documented and tested.", "queue");
  }
  if (/opentelemetry|telemetry|instrument|tracing|metrics/.test(text)) {
    add("Telemetry signal proof", "Telemetry changes should prove emitted metrics/spans or lifecycle registration, not only bean creation.", "danger");
  }
  if (/dependency|bom|version|gradle|maven/.test(text)) {
    add("Dependency path checked", "Confirm version changes align with the platform/BOM and do not mask vulnerable transitives with unnecessary direct pins.", "queue");
  }
  if (analysis?.testAssessment?.rating === "weak" || analysis?.testAssessment?.rating === "partial") {
    add("Test gap decision", "Either improve tests through Fix or explicitly record why the remaining gap is acceptable.", "danger");
  }
  if (ciSummary(ciChecks).label === "failing") {
    add("CI failure understood", "Fetch or explain failing CI before approval; do not rely only on local inspection.", "danger");
  }
  if (ciChecks.some((check) => isVulnerabilityAuditCheck(check) && check.bucket === "fail")) {
    add(
      "Vulnerability audit root cause",
      "For dependency CVEs, identify the dependency path and prefer updating the root dependency or platform BOM that brings the vulnerable transitive dependency. Add direct fixed versions only as a last resort with an explanation.",
      "danger"
    );
  }
  if (items.length === 0) add("Standard review pass", "Inspect changed source, tests, docs, CI, and unresolved comments before approval.", "neutral");
  return { scope: repo.includes("micronaut") ? "Micronaut" : "General", items };
}

function suggestedRulesFromAnalysis(analysis?: AnalysisResult): Array<{ title: string; body: string; tone: string }> {
  const insights = [...(analysis?.riskDetails ?? []), ...(analysis?.reviewerFocusDetails ?? [])];
  return insights
    .filter((item) => item.severity === "high" || item.severity === "medium")
    .slice(0, 5)
    .map((item) => ({ title: item.title, body: item.recommendation || item.perspective || item.observation, tone: toneForSeverity(item.severity) }));
}

function outcomeAwareRuleSuggestions(
  detail: PrDetail,
  analysis: AnalysisResult | undefined,
  ciChecks: CiCheck[],
  verificationJobs: VerificationJob[],
  fixJobs: FixJob[]
): Array<{ title: string; body: string; tone: string }> {
  const suggestions = [...suggestedRulesFromAnalysis(analysis)];
  const add = (title: string, body: string, tone = "queue") => {
    if (!suggestions.some((item) => item.title === title)) suggestions.push({ title, body, tone });
  };
  const text = `${detail.title} ${detail.body} ${detail.files.map((file) => file.path).join(" ")} ${(analysis?.summary ?? "")}`.toLowerCase();
  const pushedFix = latestPushedFix(fixJobs);
  const failedVerification = latestVerificationJobs(verificationJobs).find((job) => job.status === "failed" || (typeof job.exitCode === "number" && job.exitCode !== 0));
  const vulnFailure = ciChecks.find((check) => isVulnerabilityAuditCheck(check) && toneForCi(check) === "danger");
  if (pushedFix && analysis?.testAssessment?.rating && ["weak", "partial"].includes(analysis.testAssessment.rating)) {
    add("Fix sessions must leave test evidence", "When Codex pushes a fix, require either passing local/CI test evidence or a clear explanation of why verification is external.", "danger");
  }
  if (failedVerification) {
    add("Failed local verification is review evidence", "If local verification fails, future reviews should capture the root cause before approval instead of treating it as incidental output.", "danger");
  }
  if (vulnFailure) {
    add("Dependency CVE root upgrade first", "For vulnerability audit failures, identify the dependency path and prefer updating the root platform/BOM dependency before adding direct fixed transitive versions.", "danger");
  }
  if (analysis?.testAssessment?.rating === "weak" || analysis?.testAssessment?.rating === "partial") {
    add("Prefer automated coverage over manual checks", "For integration behavior, require unit/integration/TCK coverage when practical; reserve manual verification for cloud credentials, external services, or human judgment.", "queue");
  }
  if (/opentelemetry|telemetry|instrument|tracing|metrics/.test(text)) {
    add("Telemetry PRs need signal proof", "Telemetry changes should prove emitted metrics/spans or lifecycle registration with tests, not only bean creation or docs.", "danger");
  }
  return suggestions;
}

function latestVerificationJobs(jobs: VerificationJob[]): VerificationJob[] {
  const latest = new Map<string, VerificationJob>();
  for (const job of [...jobs].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    latest.set(commandKey(job.command), job);
  }
  return [...latest.values()];
}

function toneForSeverity(severity?: string): string {
  if (severity === "high") return "danger";
  if (severity === "medium") return "queue";
  if (severity === "low") return "improvement";
  return "neutral";
}
