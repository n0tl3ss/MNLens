import type { AcceptanceContract, AcceptanceCriterion, CriterionStatus, FindingKind, ReviewMemorySummary, AgentUsageSummary, AnalysisResult, CiCheck, EditorKind, FixJob, Job, PrDetail, ReviewComment, ReviewDraft, ReviewProgress, RepoReviewRule, SuggestedCommentKind, VerificationJob } from "../../../shared/types";
import { buildOverviewLinePins } from "../planHelpers";
import type { Tab } from "../reviewTypes";
import type { ReviewRecommendation } from "./OverviewSections";
import type { AgentHealthState } from "../setupAgents";
import { OverviewTab } from "./OverviewTab";
import { DiffTab } from "./DiffTab";
import { CommitTimeline } from "./CommitTimeline";
import { FixSection } from "./CodexTab";
import { CommentTab, type DraftReviewComment } from "./CommentTab";
import { ReviewTab } from "./ReviewTab";

export function DetailTab({
  tab,
  detail,
  analysis,
  usage,
  secondOpinionBusy,
  secondOpinionAgentState,
  secondOpinionError,
  onRequestSecondOpinion,
  acceptance,
  acceptanceBusy,
  acceptanceError,
  onGenerateAcceptance,
  onOverrideCriterion,
  reviewDraft,
  reviewDraftBusy,
  reviewDraftError,
  onGenerateReviewDraft,
  onUseFinalComment,
  onGoToTab,
  memory,
  onFindingFeedback,
  onCopyRepoRulesFile,
  onAnalyze,
  feedbackPreview,
  feedbackBusy,
  feedbackError,
  onPreviewFeedback,
  onPostFeedback,
  progress,
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
  openingEditor,
  expandedFile,
  onSaveProgress,
  onAddRepoRule,
  onSetRepoRuleEnabled,
  onToggleExpandedFile,
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
  selfReview,
  onOpenInDiff
}: {
  usage?: AgentUsageSummary;
  secondOpinionBusy?: boolean;
  /** Install / sign-in state of the other vendor's CLI (the second-opinion agent). */
  secondOpinionAgentState?: AgentHealthState;
  secondOpinionError?: string;
  onRequestSecondOpinion?: () => void;
  acceptance?: AcceptanceContract | null;
  acceptanceBusy?: boolean;
  acceptanceError?: string;
  onGenerateAcceptance?: (force: boolean) => void;
  onOverrideCriterion?: (criterion: AcceptanceCriterion, status: CriterionStatus | null) => void;
  reviewDraft?: ReviewDraft | null;
  reviewDraftBusy?: boolean;
  reviewDraftError?: string;
  onGenerateReviewDraft?: (force: boolean) => void;
  onUseFinalComment?: (body: string) => void;
  onGoToTab?: (tab: Tab) => void;
  memory?: ReviewMemorySummary;
  onFindingFeedback?: (kind: FindingKind, title: string, observation: string | undefined, verdict: "kept" | "dismissed" | null, commentKind?: SuggestedCommentKind) => void;
  /** The signed-in user authored this PR; review UI switches to self-review wording and comment-only submission. */
  selfReview?: boolean;
  /** Opens a file in the Diff tab (used by the reading guide). */
  onOpenInDiff?: (path: string) => void;
  onCopyRepoRulesFile?: () => void;
  onAnalyze?: () => void;
  feedbackPreview?: string;
  feedbackBusy?: boolean;
  feedbackError?: string;
  onPreviewFeedback?: (note: string) => void;
  onPostFeedback?: (body: string) => void;
  tab: Tab;
  detail?: PrDetail;
  analysis?: AnalysisResult;
  progress?: ReviewProgress;
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
  openingEditor?: EditorKind;
  expandedFile?: string;
  onSaveProgress: (patch: Partial<Pick<ReviewProgress, "checkedItems" | "reviewedFiles" | "ignoredRuleIds" | "manualChecks" | "project" | "issueProjects" | "notes" | "lastReviewedAt">>) => void;
  onAddRepoRule: (rule: { title: string; body: string; tone?: string; source?: string }) => void;
  onSetRepoRuleEnabled: (id: string, enabled: boolean) => void;
  onToggleExpandedFile: (path: string) => void;
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
}) {
  if (!detail) return <p className="empty wide">Loading PR details...</p>;
  if (tab === "review") {
    return (
      <ReviewTab
        detail={detail}
        analysis={analysis}
        acceptance={acceptance}
        draft={reviewDraft}
        draftBusy={Boolean(reviewDraftBusy)}
        draftError={reviewDraftError}
        progress={progress}
        reviewComments={reviewComments}
        verificationJobs={verificationJobs}
        ciChecks={ciChecks}
        secondOpinionBusy={secondOpinionBusy}
        memory={memory}
        selfReview={selfReview}
        onCommentVerdict={(comment, verdict) => onFindingFeedback?.("draft-comment", comment.title, comment.body, verdict, comment.kind)}
        onGenerateDraft={(force) => onGenerateReviewDraft?.(force)}
        onGenerateAcceptance={onGenerateAcceptance}
        onRequestSecondOpinion={onRequestSecondOpinion}
        onAddReviewComment={onAddReviewComment}
        onUseFinalComment={(body) => onUseFinalComment?.(body)}
        onSaveProgress={onSaveProgress}
        onGoToTab={(next) => onGoToTab?.(next)}
      />
    );
  }
  if (tab === "diff") {
    const allOverviewPins = detail.files.flatMap((file) => buildOverviewLinePins(file, analysis, detail.diff));
    return (
      <DiffTab
        detail={detail}
        analysis={analysis}
        readingGuide={analysis?.diffHash === detail.diffHash ? analysis?.readingGuide : undefined}
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
        feedbackPreview={feedbackPreview}
        feedbackBusy={feedbackBusy}
        feedbackError={feedbackError}
        selfReview={selfReview}
        onPreviewFeedback={onPreviewFeedback}
        onPostFeedback={onPostFeedback}
      />
    );
  }
  return (
    <OverviewTab
      analysis={analysis}
      usage={usage}
      secondOpinionBusy={secondOpinionBusy}
      secondOpinionAgentState={secondOpinionAgentState}
      secondOpinionError={secondOpinionError}
      onRequestSecondOpinion={onRequestSecondOpinion}
      acceptance={acceptance}
      acceptanceBusy={acceptanceBusy}
      acceptanceError={acceptanceError}
      onGenerateAcceptance={onGenerateAcceptance}
      onOverrideCriterion={onOverrideCriterion}
      memory={memory}
      onFindingFeedback={onFindingFeedback}
      onCopyRepoRulesFile={onCopyRepoRulesFile}
      onAnalyze={onAnalyze}
      onGoToTab={(next) => onGoToTab?.(next)}
      analysisRunning={analysisJobs.some((job) => job.status === "queued" || job.status === "running")}
      canApproveWithoutComments={canApproveWithoutComments}
      ciChecks={ciChecks}
      ciLoading={ciLoading}
      ciLogs={ciLogs}
      detail={detail}
      fixJobs={fixJobs}
      openingEditor={openingEditor}
      progress={progress}
      recommendation={buildRecommendation(detail, {
        analysis,
        progress,
        ciChecks,
        verificationJobs,
        fixJobs,
        draftComments: reviewComments,
        canApproveWithoutComments,
        acceptance: acceptance ?? undefined
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
      onSetRepoRuleEnabled={onSetRepoRuleEnabled}
      onStartFix={onStartFix}
      onOpenInDiff={onOpenInDiff}
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
  acceptance?: AcceptanceContract;
};

