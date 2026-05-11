import type { AnalysisResult, CiCheck, EditorKind, FixJob, GithubProject, Job, PrDetail, ReviewComment, ReviewProgress, RepoReviewRule, VerificationJob } from "../../../shared/types";
import { buildOverviewLinePins } from "../planHelpers";
import type { Tab } from "../reviewTypes";
import { reviewReplay, type ReviewReplay } from "./ReviewDeltaSection";
import type { ReviewRecommendation } from "./OverviewSections";
import { OverviewTab } from "./OverviewTab";
import { ReviewPlan } from "./PlanTab";
import { DiffTab } from "./DiffTab";
import { ReviewTraceSection } from "./ReviewTraceSection";
import { CommitTimeline } from "./CommitTimeline";
import { ResearchTab } from "./ResearchTab";
import { FixSection } from "./CodexTab";
import { CommentTab, type DraftReviewComment } from "./CommentTab";
import { HandoffTab } from "./HandoffTab";

export function DetailTab({
  tab,
  detail,
  analysis,
  progress,
  githubProjects,
  githubProjectsError,
  projectAttachBusy,
  repoRules,
  reviewComments,
  analysisJobs,
  verificationJobs,
  fixJobs,
  highlightedFixJobId,
  ciChecks,
  ciLogs,
  ciLoading,
  canApproveWithoutComments,
  attentionMode,
  openingEditor,
  expandedFile,
  wizardStep,
  onSaveProgress,
  onAttachGithubProject,
  onAddRepoRule,
  onSetRepoRuleEnabled,
  onToggleExpandedFile,
  onWizardStepChange,
  onAddReviewComment,
  onUpdateReviewComment,
  onDeleteReviewComment,
  onOpenReviewDialog,
  onRunVerification,
  onRunManualVerification,
  onOpenEditor,
  onStartFix,
  askingFixId,
  onAskFix,
  onPushFix,
  onRetryFix,
  onCancelFix,
  onRefreshFixDiff,
  onFetchCiLog,
  openConversationReplies,
  conversationReplyDrafts,
  postingConversationReply,
  onToggleConversationReply,
  onUpdateConversationReplyDraft,
  onCancelConversationReply,
  onSubmitConversationReply,
  resolvingReviewThreads,
  onResolveReviewThread,
  buildRecommendation,
  buildHandoffMarkdown
}: {
  tab: Tab;
  detail?: PrDetail;
  analysis?: AnalysisResult;
  progress?: ReviewProgress;
  githubProjects: GithubProject[];
  githubProjectsError?: string;
  projectAttachBusy: boolean;
  repoRules: RepoReviewRule[];
  reviewComments: DraftReviewComment[];
  analysisJobs: Job[];
  verificationJobs: VerificationJob[];
  fixJobs: FixJob[];
  highlightedFixJobId?: string;
  ciChecks: CiCheck[];
  ciLogs: Record<string, string>;
  ciLoading: Record<string, boolean>;
  canApproveWithoutComments: boolean;
  attentionMode: boolean;
  openingEditor?: EditorKind;
  expandedFile?: string;
  wizardStep: number;
  onSaveProgress: (patch: Partial<Pick<ReviewProgress, "checkedItems" | "reviewedFiles" | "ignoredRuleIds" | "manualChecks" | "project" | "issueProjects" | "notes" | "lastReviewedAt">>) => void;
  onAttachGithubProject: (projectId: string, includeLinkedIssues: boolean) => void;
  onAddRepoRule: (rule: { title: string; body: string; tone?: string; source?: string }) => void;
  onSetRepoRuleEnabled: (id: string, enabled: boolean) => void;
  onToggleExpandedFile: (path: string) => void;
  onWizardStepChange: (step: number) => void;
  onAddReviewComment: (comment: ReviewComment) => void;
  onUpdateReviewComment: (id: string, body: string) => void;
  onDeleteReviewComment: (id: string) => void;
  onOpenReviewDialog: () => void;
  onRunVerification: (command: string) => void;
  onRunManualVerification: (item: string, id: string) => void;
  onOpenEditor: (editor: EditorKind) => void;
  onStartFix: (instructions?: string, baseJobId?: string, source?: string) => void;
  askingFixId?: string;
  onAskFix: (id: string, question: string) => void;
  onPushFix: (id: string) => void;
  onRetryFix: (id: string, instructions?: string) => void;
  onCancelFix: (id: string) => void;
  onRefreshFixDiff: (id: string) => void;
  onFetchCiLog: (check: CiCheck) => void;
  openConversationReplies: Record<number, boolean>;
  conversationReplyDrafts: Record<number, string>;
  postingConversationReply: Record<number, boolean>;
  onToggleConversationReply: (commentId: number) => void;
  onUpdateConversationReplyDraft: (commentId: number, body: string) => void;
  onCancelConversationReply: (commentId: number) => void;
  onSubmitConversationReply: (commentId: number) => void;
  resolvingReviewThreads: Record<string, boolean>;
  onResolveReviewThread: (threadId: string) => void;
  buildRecommendation: (detail: PrDetail, context: RecommendationContext) => ReviewRecommendation;
  buildHandoffMarkdown: (args: HandoffMarkdownArgs) => string;
}) {
  if (!detail) return <p className="empty wide">Loading PR details...</p>;
  if (tab === "plan") {
    return (
      <ReviewPlan
        detail={detail}
        analysis={analysis}
        progress={progress}
        comments={reviewComments}
        canApproveWithoutComments={canApproveWithoutComments}
        wizardStep={wizardStep}
        onWizardStepChange={onWizardStepChange}
        onSaveProgress={onSaveProgress}
        onAddComment={onAddReviewComment}
        onUpdateComment={onUpdateReviewComment}
        onDeleteComment={onDeleteReviewComment}
        onOpenReviewDialog={onOpenReviewDialog}
      />
    );
  }
  if (tab === "diff") {
    const allOverviewPins = detail.files.flatMap((file) => buildOverviewLinePins(file, analysis, detail.diff));
    return (
      <DiffTab
        detail={detail}
        analysis={analysis}
        progress={progress}
        reviewComments={reviewComments}
        expandedFile={expandedFile}
        overviewPins={allOverviewPins}
        canApproveWithoutComments={canApproveWithoutComments}
        onSaveProgress={onSaveProgress}
        onToggleExpandedFile={onToggleExpandedFile}
        onAddReviewComment={onAddReviewComment}
        onUpdateReviewComment={onUpdateReviewComment}
        onDeleteReviewComment={onDeleteReviewComment}
        onOpenReviewDialog={onOpenReviewDialog}
      />
    );
  }
  if (tab === "commits") {
    return <CommitTimeline commits={detail.commits ?? []} detail={detail} analysis={analysis} reviewComments={reviewComments} />;
  }
  if (tab === "research") {
    return <ResearchTab detail={detail} analysis={analysis} onStartFix={onStartFix} />;
  }
  if (tab === "fix") {
    return (
      <div className="panel fix-panel">
        <FixSection
          jobs={fixJobs}
          analysisJobs={analysisJobs}
          verificationJobs={verificationJobs}
          highlightedJobId={highlightedFixJobId}
          askingFixId={askingFixId}
          onStart={onStartFix}
          onAsk={onAskFix}
          onPush={onPushFix}
          onRetry={onRetryFix}
          onCancel={onCancelFix}
          onRefreshDiff={onRefreshFixDiff}
        />
      </div>
    );
  }
  if (tab === "comment") {
    return (
      <CommentTab
        detail={detail}
        analysis={analysis}
        progress={progress}
        reviewComments={reviewComments}
        verificationJobs={verificationJobs}
        fixJobs={fixJobs}
        canApproveWithoutComments={canApproveWithoutComments}
        openConversationReplies={openConversationReplies}
        conversationReplyDrafts={conversationReplyDrafts}
        postingConversationReply={postingConversationReply}
        resolvingReviewThreads={resolvingReviewThreads}
        onSaveProgress={onSaveProgress}
        onStartFix={onStartFix}
        onAddReviewComment={onAddReviewComment}
        onToggleConversationReply={onToggleConversationReply}
        onUpdateConversationReplyDraft={onUpdateConversationReplyDraft}
        onCancelConversationReply={onCancelConversationReply}
        onSubmitConversationReply={onSubmitConversationReply}
        onResolveReviewThread={onResolveReviewThread}
      />
    );
  }
  if (tab === "handoff") {
    const recommendation = buildRecommendation(detail, {
      analysis,
      progress,
      ciChecks,
      verificationJobs,
      fixJobs,
      draftComments: reviewComments,
      canApproveWithoutComments
    });
    const replay = reviewReplay(detail, progress, ciChecks, verificationJobs, fixJobs);
    const markdown = buildHandoffMarkdown({
      detail,
      analysis,
      progress,
      repoRules,
      reviewComments,
      verificationJobs,
      fixJobs,
      ciChecks,
      recommendation,
      replay
    });
    return (
      <HandoffTab
        detail={detail}
        analysis={analysis}
        reviewComments={reviewComments}
        verificationJobs={verificationJobs}
        fixJobs={fixJobs}
        recommendation={recommendation}
        replay={replay}
        markdown={markdown}
      />
    );
  }
  return (
    <OverviewTab
      analysis={analysis}
      attentionMode={attentionMode}
      canApproveWithoutComments={canApproveWithoutComments}
      ciChecks={ciChecks}
      ciLoading={ciLoading}
      ciLogs={ciLogs}
      detail={detail}
      fixJobs={fixJobs}
      openingEditor={openingEditor}
      progress={progress}
      githubProjects={githubProjects}
      githubProjectsError={githubProjectsError}
      projectAttachBusy={projectAttachBusy}
      recommendation={buildRecommendation(detail, {
        analysis,
        progress,
        ciChecks,
        verificationJobs,
        fixJobs,
        draftComments: reviewComments,
        canApproveWithoutComments
      })}
      repoRules={repoRules}
      reviewComments={reviewComments}
      verificationJobs={verificationJobs}
      onAddRepoRule={onAddRepoRule}
      onFetchCiLog={onFetchCiLog}
      onOpenEditor={onOpenEditor}
      onRunManualVerification={onRunManualVerification}
      onRunVerification={onRunVerification}
      onSaveProgress={onSaveProgress}
      onAddReviewComment={onAddReviewComment}
      onAttachGithubProject={onAttachGithubProject}
      onSetRepoRuleEnabled={onSetRepoRuleEnabled}
      onStartFix={onStartFix}
    />
  );
}

export type RecommendationContext = {
  analysis?: AnalysisResult;
  progress?: ReviewProgress;
  ciChecks?: CiCheck[];
  verificationJobs?: VerificationJob[];
  fixJobs?: FixJob[];
  draftComments?: DraftReviewComment[];
  canApproveWithoutComments?: boolean;
};

export type HandoffMarkdownArgs = {
  detail: PrDetail;
  analysis?: AnalysisResult;
  progress?: ReviewProgress;
  repoRules: RepoReviewRule[];
  reviewComments: DraftReviewComment[];
  verificationJobs: VerificationJob[];
  fixJobs: FixJob[];
  ciChecks: CiCheck[];
  recommendation: ReviewRecommendation;
  replay: ReviewReplay;
};
