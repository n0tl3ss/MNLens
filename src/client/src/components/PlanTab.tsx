import { BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Search, Send, ShieldAlert, Sparkles } from "lucide-react";
import type { AnalysisResult, PrDetail, ReviewComment, ReviewProgress } from "../../../shared/types";
import { buildFileReviewSignals, buildOverviewLinePins, buildReviewChecklist, isTestOrSupportFile, rankFiles, submitReviewLabel, type PlanFileSignal } from "../planHelpers";
import { DiffViewer, extractFileDiff } from "./DiffViewer";
import type { DraftReviewComment } from "./CommentTab";
import { Badge, plural } from "./uiBits";
import "./planTab.css";

export function ReviewPlan({
  detail,
  analysis,
  progress,
  comments,
  canApproveWithoutComments,
  wizardStep,
  onWizardStepChange,
  onSaveProgress,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onOpenReviewDialog
}: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  progress?: ReviewProgress;
  comments: DraftReviewComment[];
  canApproveWithoutComments: boolean;
  wizardStep: number;
  onWizardStepChange: (step: number) => void;
  onSaveProgress: (patch: Partial<Pick<ReviewProgress, "checkedItems" | "reviewedFiles" | "manualChecks" | "notes" | "lastReviewedAt">>) => void;
  onAddComment: (comment: ReviewComment) => void;
  onUpdateComment: (id: string, body: string) => void;
  onDeleteComment: (id: string) => void;
  onOpenReviewDialog: () => void;
}) {
  const checkedItems = progress?.checkedItems ?? [];
  const reviewedFiles = progress?.reviewedFiles ?? [];
  const checklist = buildReviewChecklist(detail, analysis);
  const files = rankFiles(detail, analysis);
  const steps = files.map((file, index) => ({
    id: `file:${file.path}`,
    title: index === 0 ? "Start with highest-signal file" : "Inspect changed file",
    detail: file.reason,
    file,
    signals: buildFileReviewSignals(file, analysis, detail.diff)
  }));
  const sourceSteps = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => !isTestOrSupportFile(step.file.path));
  const testSteps = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => isTestOrSupportFile(step.file.path));
  const activeStep = steps[Math.min(wizardStep, Math.max(steps.length - 1, 0))];
  const reviewedCount = reviewedFiles.length;
  const activeReviewed = activeStep ? reviewedFiles.includes(activeStep.file.path) : false;
  const activeHelpers = activeStep ? buildStepHelpers(activeStep.file, analysis) : [];
  const activeOverviewPins = activeStep ? buildOverviewLinePins(activeStep.file, analysis, detail.diff) : [];

  function toggleItem(id: string, advance = false) {
    onSaveProgress({
      checkedItems: checkedItems.includes(id) ? checkedItems.filter((item) => item !== id) : [...checkedItems, id]
    });
    if (advance && !checkedItems.includes(id)) {
      onWizardStepChange(Math.min(wizardStep + 1, Math.max(steps.length - 1, 0)));
    }
  }

  function toggleFile(path: string, advance = false) {
    onSaveProgress({
      reviewedFiles: reviewedFiles.includes(path) ? reviewedFiles.filter((item) => item !== path) : [...reviewedFiles, path]
    });
    if (advance && !reviewedFiles.includes(path)) {
      onWizardStepChange(Math.min(wizardStep + 1, Math.max(steps.length - 1, 0)));
    }
  }

  function completeActiveStep() {
    if (!activeStep) return;
    if (!reviewedFiles.includes(activeStep.file.path)) toggleFile(activeStep.file.path);
    onWizardStepChange(Math.min(wizardStep + 1, Math.max(steps.length - 1, 0)));
  }

  return (
    <div className="wizard-layout">
      <section className="summary-card plan-hero">
        <div>
          <h3>Review Progress</h3>
          <p>{reviewedCount} of {detail.files.length} files reviewed. Step {steps.length === 0 ? 0 : wizardStep + 1} of {steps.length}.</p>
          <p className="muted">
            Showing the full PR diff between <b>{detail.baseRefName || "target branch"}</b> and <b>{detail.headRefName || "PR branch"}</b>, not only the latest commit.
          </p>
        </div>
        <progress value={detail.files.length === 0 ? 0 : reviewedCount / detail.files.length} max={1} />
      </section>

      <aside className="summary-card wizard-sidebar">
        <h3>Review Wizard</h3>
        {!analysis && <p className="muted">Run analysis to add AI prompts, research links, and risk cues.</p>}
        <div className="wizard-lanes">
          {checklist.slice(0, 3).map((item, index) => (
            <label key={item.id} className={checkedItems.includes(item.id) ? "checked" : ""}>
              <input type="checkbox" checked={checkedItems.includes(item.id)} onChange={() => toggleItem(item.id, true)} />
              <span>{index + 1}</span>
              <strong>{item.title}</strong>
            </label>
          ))}
        </div>
        <h3>Changed Files</h3>
        <div className="wizard-file-groups">
          <WizardFileGroup
            title="Source Changes"
            empty="No production source changes."
            prefix="S"
            items={sourceSteps}
            wizardStep={wizardStep}
            reviewedFiles={reviewedFiles}
            onWizardStepChange={onWizardStepChange}
          />
          <WizardFileGroup
            title="Tests, Docs & Support"
            empty="No test or support changes."
            prefix="T"
            items={testSteps}
            wizardStep={wizardStep}
            reviewedFiles={reviewedFiles}
            onWizardStepChange={onWizardStepChange}
          />
        </div>
      </aside>

      <section className="wizard-main">
        {activeStep ? (
          <>
            <div className="summary-card wizard-current">
              <div>
                <p className="eyebrow">{activeStep.title}</p>
                <h3>{activeStep.file.path}</h3>
                <p>{activeStep.detail}</p>
                <div className="file-stats">
                  <Badge tone="added">+{activeStep.file.additions}</Badge>
                  <Badge tone="danger">-{activeStep.file.deletions}</Badge>
                  {activeStep.file.changeType && <Badge tone="label">{activeStep.file.changeType}</Badge>}
                  {activeStep.signals.slice(0, 3).map((signal) => (
                    <Badge key={`${signal.kind}-${signal.title}`} tone={signal.tone}>{signal.kind}</Badge>
                  ))}
                </div>
              </div>
              <div className="wizard-actions">
                <button disabled={wizardStep === 0} onClick={() => onWizardStepChange(Math.max(0, wizardStep - 1))}>
                  <ChevronLeft size={16} />
                  Previous
                </button>
                <button onClick={completeActiveStep}>
                  Mark reviewed
                  <ChevronRight size={16} />
                </button>
                <button
                  disabled={comments.filter((comment) => comment.body.trim().length > 0).length === 0 && !canApproveWithoutComments}
                  onClick={onOpenReviewDialog}
                >
                  <Send size={16} />
                  {submitReviewLabel(comments.filter((comment) => comment.body.trim().length > 0).length, canApproveWithoutComments)}
                </button>
              </div>
            </div>
            <section className="wizard-guidance">
              <label className={`step-check ${activeReviewed ? "checked" : ""}`}>
                <input
                  type="checkbox"
                  checked={activeReviewed}
                  onChange={() => toggleFile(activeStep.file.path, true)}
                />
                <span>
                  <strong>I inspected this file and any comments are drafted inline.</strong>
                  <em>Checking this moves to the next file so the review stays step-by-step.</em>
                </span>
              </label>
              <div className="assistant-grid">
                {activeHelpers.map((helper) => (
                  <article className={`assistant-card ${helper.tone}`} key={`${helper.title}-${helper.body}`}>
                    <div>
                      {helper.icon}
                      <strong>{helper.title}</strong>
                    </div>
                    <p>{helper.body}</p>
                    {helper.url && (
                      <a href={helper.url} target="_blank" rel="noreferrer">
                        Open reference
                      </a>
                    )}
                  </article>
                ))}
              </div>
            </section>
            <DiffViewer
              diff={extractFileDiff(detail.diff, activeStep.file.path)}
              detail={detail}
              comments={comments}
              existingComments={detail.reviewComments}
              overviewPins={activeOverviewPins}
              onAddComment={onAddComment}
              onUpdateComment={onUpdateComment}
              onDeleteComment={onDeleteComment}
            />
          </>
        ) : (
          <p className="empty wide">No changed files to review.</p>
        )}
      </section>

      <section className="summary-card wizard-notes">
        <h3>Reviewer Notes</h3>
        <textarea
          className="review-notes"
          value={progress?.notes ?? ""}
          placeholder="Private notes for this review"
          onChange={(event) => onSaveProgress({ notes: event.target.value })}
        />
      </section>
    </div>
  );
}

function WizardFileGroup({
  title,
  empty,
  prefix,
  items,
  wizardStep,
  reviewedFiles,
  onWizardStepChange
}: {
  title: string;
  empty: string;
  prefix: string;
  items: Array<{
    step: {
      id: string;
      detail: string;
      file: PrDetail["files"][number];
      signals: PlanFileSignal[];
    };
    index: number;
  }>;
  wizardStep: number;
  reviewedFiles: string[];
  onWizardStepChange: (step: number) => void;
}) {
  return (
    <section className="wizard-file-group">
      <div>
        <strong>{title}</strong>
        <Badge tone="neutral">{plural(items.length, "file")}</Badge>
      </div>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="wizard-steps">
          {items.map(({ step, index }, groupIndex) => (
            <button
              key={step.id}
              className={`${index === wizardStep ? "active" : ""} ${reviewedFiles.includes(step.file.path) ? "done" : ""}`}
              onClick={() => onWizardStepChange(index)}
            >
              <span>{prefix}{groupIndex + 1}</span>
              <strong>{step.file.path}</strong>
              <em>{reviewedFiles.includes(step.file.path) ? `Reviewed, step ${index + 1}` : `Step ${index + 1}: ${step.detail}`}</em>
              {step.signals.length > 0 && (
                <small>
                  {step.signals.slice(0, 3).map((signal) => (
                    <b key={`${signal.kind}-${signal.title}`} className={signal.tone}>{signal.kind}</b>
                  ))}
                </small>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function buildStepHelpers(file: PrDetail["files"][number], analysis?: AnalysisResult) {
  const pathText = file.path.toLowerCase();
  const supportFile = isTestOrSupportFile(file.path);
  const focus =
    analysis?.reviewerFocus.find((item) => item.toLowerCase().includes(pathText)) ??
    (supportFile ? analysis?.testAssessment?.summary : analysis?.reviewerFocus[0]) ??
    "Review the intent, edge cases, and whether the implementation matches the PR description.";
  const risk =
    analysis?.risks.find((item) => item.toLowerCase().includes(pathText)) ??
    (supportFile ? analysis?.testAssessment?.gaps[0] : analysis?.caveats[0]) ??
    "Look for behavior changes, lifecycle effects, and missing failure-path handling.";
  const test =
    analysis?.testsToCheck.find((item) => item.toLowerCase().includes(pathText)) ??
    analysis?.testsToCheck[0] ??
    (file.path.includes("test") ? "Check that this test would fail before the PR and proves the new behavior." : "Confirm there is nearby coverage for this change.");
  const source =
    [...(analysis?.docs ?? []), ...(analysis?.similarImplementations ?? [])].find((item) =>
      `${item.title} ${item.reason}`.toLowerCase().includes(pathText.split("/").at(-1)?.toLowerCase() ?? pathText)
    ) ?? analysis?.docs[0] ?? analysis?.similarImplementations[0];

  return [
    { title: "Review focus", body: focus, icon: <Sparkles size={16} />, tone: "focus" },
    { title: "Risk check", body: risk, icon: <ShieldAlert size={16} />, tone: "risk" },
    { title: "Verification", body: test, icon: <CheckCircle2 size={16} />, tone: "test" },
    {
      title: source ? "Research reference" : "Research agent",
      body: source?.reason ?? "Run analysis to collect docs and similar GitHub implementations for this PR.",
      url: source?.url,
      icon: source ? <BookOpen size={16} /> : <Search size={16} />,
      tone: "research"
    }
  ];
}
