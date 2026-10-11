export type QueueName = "assigned" | "review-requested" | "reviewed" | "all";
export type PrQueue = "assigned" | "review-requested" | "reviewed" | "authored";

export type AnalysisType =
  | "feature"
  | "bug"
  | "improvement"
  | "refactor"
  | "docs"
  | "test"
  | "chore"
  | "unknown";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PrListItem extends PrRef {
  key: string;
  title: string;
  url: string;
  repository: string;
  author: string;
  authorUrl?: string;
  labels: string[];
  queues: PrQueue[];
  state: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  commentsCount: number;
  changedFiles?: number;
  reviewDecision?: string;
  mergeStateStatus?: string;
  branchBehindBy?: number;
  branchAheadBy?: number;
  aiType?: AnalysisType;
  analysisStatus?: JobStatus;
  analysisMode?: "fast" | "deep";
  analysisUpdatedAt?: string;
  aiRiskCount?: number;
  aiTestsCount?: number;
  fastScore?: number;
  fastScoreLabel?: string;
  fastScoreTone?: string;
  fastScoreConfidence?: "low" | "medium" | "high";
}

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
  changeType?: string;
}

export interface PrCommitFile extends PrFile {
  previousPath?: string;
  patch?: string;
}

export interface PrCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authorUrl?: string;
  authoredAt: string;
  committer: string;
  committedAt: string;
  url: string;
  files: PrCommitFile[];
}

export interface LinkedIssue {
  number: number;
  title: string;
  url: string;
  nodeId?: string;
  state?: string;
  repository?: string;
  body?: string;
  author?: string;
  authorUrl?: string;
  commentsCount?: number;
  labels?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PrDetail extends PrListItem {
  body: string;
  nodeId?: string;
  linkedIssues: LinkedIssue[];
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision?: string;
  mergeStateStatus?: string;
  branchBehindBy?: number;
  branchAheadBy?: number;
  reviewers: PrReviewerStatus[];
  githubProjects?: GithubProject[];
  files: PrFile[];
  commits: PrCommit[];
  conversationComments: ExistingComment[];
  reviewSummaries: ExistingReviewSummary[];
  reviewComments: ExistingReviewComment[];
  diff: string;
  diffHash: string;
}

export interface PrReviewerStatus {
  login: string;
  url?: string;
  status: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING" | "UNKNOWN";
  source: "review" | "request";
  submittedAt?: string;
}

export interface RepositoryBranch {
  name: string;
  url?: string;
  protected?: boolean;
}

export interface AnalysisResult {
  prKey: string;
  diffHash: string;
  /** Fingerprint of comments/reviews/linked issues at analysis time; see shared/analysisContext.ts. */
  contextHash?: string;
  type: AnalysisType;
  confidence: number;
  summary: string;
  evidence: string[];
  evidenceDetails?: ReviewInsight[];
  behaviorBefore?: string;
  behaviorAfter?: string;
  reviewerFocus: string[];
  reviewerFocusDetails?: ReviewInsight[];
  risks: string[];
  riskDetails?: ReviewInsight[];
  testsToCheck: string[];
  testAssessment?: TestAssessment;
  docs: SourceLink[];
  similarImplementations: SourceLink[];
  caveats: string[];
  draftComment: string;
  generatedAt: string;
  modelNote?: string;
  /** Agent/model that produced this analysis (absent on analyses cached before multi-agent support). */
  agent?: AgentId;
  model?: string;
  costUsd?: number;
  /** Stack context captured at analysis time, so reviewers can see the diff was judged relative to a parent PR. */
  stack?: { parentNumber?: number; parentTitle?: string; position?: number; size?: number };
  /** Cross-agent audit of this analysis; see server/secondOpinion.ts. */
  secondOpinion?: SecondOpinion;
}

export interface SecondOpinion {
  agent: AgentId;
  model: string;
  generatedAt: string;
  /** diffHash of the analysis this opinion audited. */
  diffHash: string;
  costUsd?: number;
  verdict: "agree" | "mostly-agree" | "disagree";
  confidence: number;
  summary: string;
  agreements: string[];
  disputed: Array<{ item: string; reason: string; severity: "info" | "low" | "medium" | "high" }>;
  missed: Array<{ title: string; observation: string; recommendation: string; severity: "info" | "low" | "medium" | "high" }>;
  draftCommentIssues: string[];
}

export interface SecondOpinionRequest extends PrRef {}

export interface ReviewInsight {
  title: string;
  observation: string;
  perspective: string;
  recommendation: string;
  severity: "info" | "low" | "medium" | "high";
}

export interface TestAssessment {
  rating: "unknown" | "weak" | "partial" | "good" | "strong";
  summary: string;
  covered: string[];
  gaps: string[];
  recommendedTests: string[];
}

export interface SourceLink {
  title: string;
  url: string;
  reason: string;
  framework?: string;
  repository?: string;
  filePath?: string;
  codeSnippet?: string;
  snippetSourceUrl?: string;
  comparison?: string;
  caveat?: string;
}

export interface AuthStatus {
  hasKeychainToken: boolean;
  ghAvailable: boolean;
  ghAuthenticated: boolean;
  tokenStore: "macos-keychain" | "windows-credential-manager" | "linux-secret-service" | "unsupported";
  setupSupported: boolean;
  setupHint: string;
  scopeCheck?: "ok" | "limited" | "missing" | "unknown";
  tokenScopes?: string[];
  missingScopes?: string[];
  scopeHint?: string;
  username?: string;
  githubRateLimit?: GithubRateLimitInfo;
  error?: string;
}

export interface GithubRateLimitInfo {
  limited: boolean;
  limit?: number;
  remaining?: number;
  used?: number;
  resetAt?: string;
  resource?: string;
  until?: string;
  retryAfterSeconds?: number;
  message?: string;
}

export interface StoreGithubTokenRequest {
  token: string;
}

export interface DependencyCheck {
  id: string;
  name: string;
  required: boolean;
  installed: boolean;
  version?: string;
  details?: string;
  installHint: string;
  /** Dependencies in the same group satisfy readiness when at least one member group is complete. */
  group?: AgentId;
}

export interface SetupStatus {
  checkedAt: string;
  platform: string;
  ready: boolean;
  dependencies: DependencyCheck[];
  /** Agent CLIs that are installed and authenticated. */
  availableAgents: AgentId[];
  /** Agent MNLens will use for analysis/fix sessions. */
  selectedAgent: AgentId;
}

// ---------------------------------------------------------------------------
// Agent (Codex / Claude) configuration
// ---------------------------------------------------------------------------

export type AgentId = "codex" | "claude";

export type ModelTier = "economy" | "standard" | "premium";

export type AgentTask =
  | "deep-analysis"
  | "quick-answer"
  | "ci-explain"
  | "research-answer"
  | "fix-research"
  | "fix-implementation"
  | "fix-tests-qa"
  | "fix-docs"
  | "fix-security"
  | "fix-final-review"
  | "fix-qa-assessment"
  | "fix-question"
  | "conflict-resolution"
  | "manual-check"
  | "second-opinion"
  | "acceptance-contract"
  | "setup-probe";

export interface TierModel {
  model: string;
  /** Reasoning effort: Claude `--effort low|medium|high`, Codex `model_reasoning_effort` low|medium|high|xhigh. */
  effort?: string;
}

export interface AgentSettings {
  agent: AgentId;
  tiers: Record<AgentId, Record<ModelTier, TierModel>>;
  taskTiers: Record<AgentTask, ModelTier>;
  /** Claude only: `--max-budget-usd` per agent run. */
  maxBudgetUsdPerRun?: number;
  updatedAt: string;
}

export interface UpdateAgentSettingsRequest {
  agent?: AgentId;
  tiers?: Partial<Record<AgentId, Partial<Record<ModelTier, Partial<TierModel> & { effort?: string | null }>>>>;
  taskTiers?: Partial<Record<AgentTask, ModelTier>>;
  maxBudgetUsdPerRun?: number | null;
}

export interface AgentUsageEntry {
  at: string;
  prKey?: string;
  task: AgentTask;
  agent: AgentId;
  model: string;
  tier: ModelTier;
  durationMs: number;
  /** Reported by the CLI when available (Claude Code `total_cost_usd`); absent for Codex. */
  costUsd?: number;
  sessionId?: string;
  ok: boolean;
}

export interface AgentUsageSummary {
  prKey?: string;
  runs: number;
  runsWithCost: number;
  totalCostUsd: number;
  totalDurationMs: number;
  byTask: Partial<Record<AgentTask, { runs: number; costUsd: number; durationMs: number }>>;
  byAgent: Partial<Record<AgentId, { runs: number; costUsd: number; durationMs: number }>>;
  recent: AgentUsageEntry[];
}

// ---------------------------------------------------------------------------
// Acceptance-criteria contract
// ---------------------------------------------------------------------------

export type CriterionStatus = "proven" | "unproven" | "failed" | "not-applicable";

export interface CriterionEvidence {
  kind: "test" | "file" | "ci" | "command" | "comment" | "docs";
  /** Test name, `path:line`, CI check name, command, or URL. */
  ref: string;
  note?: string;
}

export interface AcceptanceCriterion {
  id: string;
  text: string;
  source: "linked-issue" | "pr-body" | "derived";
  /** Where the criterion came from (issue number / section) for traceability. */
  origin?: string;
  status: CriterionStatus;
  evidence: CriterionEvidence[];
  note?: string;
  /** Reviewer override of the agent's status; wins when present. */
  humanStatus?: CriterionStatus;
  humanNote?: string;
  humanUpdatedAt?: string;
}

export interface AcceptanceContract {
  prKey: string;
  diffHash: string;
  generatedAt: string;
  agent: AgentId;
  model: string;
  costUsd?: number;
  summary: string;
  criteria: AcceptanceCriterion[];
  /** Things the agent could not verify locally and why (e.g. needs a real cloud resource). */
  limitations: string[];
}

export interface AcceptanceContractRequest extends PrRef {
  force?: boolean;
}

export interface UpdateCriterionRequest {
  status?: CriterionStatus | null;
  note?: string | null;
}

// ---------------------------------------------------------------------------
// Review memory (human verdicts on AI findings)
// ---------------------------------------------------------------------------

export type FindingVerdict = "kept" | "dismissed";

export interface FindingFeedback {
  id: string;
  prKey: string;
  repository: string;
  author?: string;
  kind: "evidence" | "focus" | "risk" | "test" | "criterion";
  title: string;
  observation?: string;
  verdict: FindingVerdict;
  reason?: string;
  at: string;
}

export interface RecordFindingFeedbackRequest extends PrRef {
  kind: FindingFeedback["kind"];
  title: string;
  observation?: string;
  verdict: FindingVerdict | null;
  reason?: string;
}

export interface ReviewMemoryPattern {
  key: string;
  label: string;
  kept: number;
  dismissed: number;
  examples: string[];
  /** Suggested repo rule text when a pattern is mostly dismissed or always kept. */
  suggestedRule?: string;
}

export interface ReviewMemorySummary {
  repository: string;
  total: number;
  kept: number;
  dismissed: number;
  patterns: ReviewMemoryPattern[];
  /** Verdicts for the current PR, keyed by `${kind}:${normalized title}`. */
  prVerdicts: Record<string, FindingVerdict>;
}

// ---------------------------------------------------------------------------
// Author feedback comment
// ---------------------------------------------------------------------------

export interface FeedbackCommentPreview {
  body: string;
  sections: string[];
}

export interface PostFeedbackCommentRequest extends PrRef {
  body: string;
}

// ---------------------------------------------------------------------------
// Stacked pull requests
// ---------------------------------------------------------------------------

export interface PrStackNode {
  number: number;
  title: string;
  url: string;
  author: string;
  baseRefName: string;
  headRefName: string;
  isDraft: boolean;
  state: string;
  mergeStateStatus?: string;
  reviewDecision?: string;
  isInMergeQueue?: boolean;
  mergeable?: string;
  /** Number of the PR whose head branch this PR targets, if that PR is open. */
  parentNumber?: number;
  childNumbers: number[];
}

export interface PrStack {
  repository: string;
  number: number;
  /** True when the PR has an open parent or at least one open child. */
  isStacked: boolean;
  /** Ordered root → leaf along the chain that contains `number`. Children of the leaf are listed in `childNumbers`. */
  chain: PrStackNode[];
  /** 1-based position of `number` inside `chain`. */
  position: number;
  parent?: PrStackNode;
  children: PrStackNode[];
  /** Base branch of the root PR (usually the repository default branch). */
  trunk: string;
  fetchedAt: string;
}

export type StackMergeMethod = "merge" | "squash" | "rebase";

export interface StackMergeStep {
  number: number;
  title: string;
  headRefName: string;
  /** Whether this PR could be merged right now (approved, clean, not draft, parent merged). */
  ready: boolean;
  blockers: string[];
  isCurrent: boolean;
  isNext: boolean;
}

export interface StackMergePlan {
  repository: string;
  trunk: string;
  steps: StackMergeStep[];
  /** Number of the PR that should be merged next, if any is ready. */
  nextNumber?: number;
  mergeQueueActive: boolean;
}

export interface StackMergeRequest extends PrRef {
  method: StackMergeMethod;
  deleteBranch?: boolean;
}

export interface StackMergeResponse extends PrRef {
  merged: boolean;
  message: string;
  /** Children that now target the trunk and should be restacked. */
  childrenToRestack: number[];
}

export interface PrStackSummary {
  size: number;
  position: number;
  parentNumber?: number;
  childNumbers: number[];
}

export type PrStackSummaryMap = Record<string, PrStackSummary>;

export interface LocalSessionStatus {
  token: string;
  mode: "local";
  betaLimitations: string[];
}

export interface Job {
  id: string;
  status: JobStatus;
  prKey: string;
  mode?: "fast" | "deep";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  statusMessage?: string;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  interruptedAt?: string;
  resumable?: boolean;
  recoveryMessage?: string;
  error?: string;
  fast?: Pick<PrListItem, "aiType" | "aiRiskCount" | "aiTestsCount" | "analysisStatus" | "analysisMode" | "analysisUpdatedAt" | "changedFiles" | "reviewDecision" | "mergeStateStatus" | "branchBehindBy" | "branchAheadBy" | "fastScore" | "fastScoreLabel" | "fastScoreTone" | "fastScoreConfidence">;
  result?: AnalysisResult;
}

export interface VerificationJob {
  id: string;
  status: JobStatus;
  prKey: string;
  command: string;
  phase?: "queued" | "preparing" | "cloning" | "checking-out" | "running" | "completed";
  statusMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  repoDir?: string;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  durationMs?: number;
  interruptedAt?: string;
  resumable?: boolean;
  recoveryMessage?: string;
  error?: string;
  artifacts?: VerificationArtifact[];
}

export interface VerificationArtifact {
  label: string;
  path: string;
  kind: "screenshot" | "html" | "log" | "diff" | "json" | "file";
  url?: string;
}

export interface FixJob {
  id: string;
  status: JobStatus;
  prKey: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  phase?:
    | "queued"
    | "preparing"
    | "checking-out"
    | "research"
    | "implementation"
    | "tests-qa"
    | "docs"
    | "security"
    | "final-review"
    | "codex"
    | "testing"
    | "committing"
    | "pushing"
    | "completed";
  statusMessage?: string;
  source?: string;
  instructions?: string;
  baseJobId?: string;
  /** Agent CLI that owns this fix session. Older jobs without this field were Codex sessions. */
  agent?: AgentId;
  /** Resumable agent session id (Codex thread id or Claude session id). */
  agentSessionId?: string;
  /** @deprecated Kept for jobs persisted before multi-agent support; use `agentSessionId`. */
  codexSessionId?: string;
  pipeline?: FixPipelineNode[];
  qaSummary?: string;
  qaFailures?: string[];
  conversation?: FixConversationMessage[];
  repoDir?: string;
  stdout: string;
  stderr: string;
  error?: string;
  exitCode?: number | null;
  diff?: string;
  interruptedAt?: string;
  resumable?: boolean;
  recoveryMessage?: string;
  pushedAt?: string;
  committed?: boolean;
  pushed?: boolean;
  commitSha?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface FixConversationMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
  createdAt: string;
}

export interface FixPipelineNode {
  phase: Exclude<
    NonNullable<FixJob["phase"]>,
    "queued" | "preparing" | "checking-out" | "codex" | "testing" | "committing" | "pushing" | "completed"
  >;
  label: string;
  status: "pending" | "current" | "done" | "waiting" | "failed";
  attempts?: number;
  message?: string;
  updatedAt?: string;
}

export interface FixRequest extends PrRef {
  push?: boolean;
  instructions?: string;
  source?: string;
  baseJobId?: string;
  draftComments?: ReviewComment[];
}

export interface PushFixRequest {
  id: string;
}

export interface RetryFixRequest {
  id: string;
  instructions?: string;
}

export interface AskFixRequest {
  id: string;
  question: string;
}

export interface AskFixResponse {
  job: FixJob;
  answer: string;
}

export interface FixLiveDiffResponse {
  id: string;
  diff: string;
  repoDir?: string;
  updatedAt: string;
}

export interface VerificationRequest extends PrRef {
  command: string;
}

export type EditorKind = "vscode" | "intellij";

export interface OpenEditorRequest extends PrRef {
  editor: EditorKind;
}

export interface OpenEditorResponse {
  editor: EditorKind;
  repoDir: string;
  command: string;
}

export interface ManualVerificationRequest extends PrRef {
  item: string;
  id: string;
}

export interface CiCheck {
  name: string;
  workflow: string;
  state: string;
  bucket: string;
  description: string;
  link: string;
  details?: string;
  startedAt: string;
  completedAt: string;
  canFetchLog: boolean;
}

export interface CiLogRequest extends PrRef {
  link: string;
}

export interface CiLogResponse {
  log: string;
}

export interface AskRiskRequest extends PrRef {
  risk: ReviewInsight | { observation: string };
  question: string;
}

export interface AskRiskResponse {
  answer: string;
}

export interface AskCiRequest extends PrRef {
  check: CiCheck;
  log?: string;
}

export interface AskCiResponse {
  answer: string;
}

export interface AskResearchRequest extends PrRef {
  source: SourceLink;
  question: string;
}

export interface AskResearchResponse {
  answer: string;
}

export interface RebasePrRequest extends PrRef {}

export type BranchUpdateStrategy = "rebase" | "merge";

export interface RebasePrResponse {
  success: boolean;
  strategy?: BranchUpdateStrategy;
  strategyReason?: string;
  defaultBranch: string;
  stdout: string;
  stderr: string;
  message: string;
  previewId?: string;
  diff?: string;
  repoDir?: string;
  headRefName?: string;
  headRepository?: string;
  conflictsResolved?: number;
  pushed?: boolean;
}

export interface RebasePrConfirmRequest {
  previewId: string;
}

export interface UpdatePrTargetBranchRequest extends PrRef {
  baseRefName: string;
}

export interface UpdatePrTargetBranchResponse extends PrRef {
  baseRefName: string;
  message: string;
}

export interface CacheStats {
  prCount: number;
  analysisCount: number;
  cacheDir: string;
}

export interface CacheExportResponse {
  exportedAt: string;
  fileName: string;
  path: string;
  url: string;
}

export interface ClearCacheResponse {
  clearedAt: string;
  cacheDir: string;
}

export interface GithubProject {
  id: string;
  title: string;
  url?: string;
  number?: number;
  owner: string;
  ownerType?: "organization" | "user";
}

export interface AttachGithubProjectRequest extends PrRef {
  projectId: string;
  includeLinkedIssues?: boolean;
}

export interface AttachGithubProjectResponse {
  projectId: string;
  attached: Array<{ type: "pull-request" | "issue"; repository: string; number: number; itemId?: string }>;
}

export interface AnalyzeRequest {
  prs: PrRef[];
  force?: boolean;
  mode?: "fast" | "deep";
}

export interface AnalyzeResponse {
  jobs: Job[];
}

export type ReviewDecision = "APPROVE" | "REQUEST_CHANGES";

export interface ReviewComment {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
}

export interface ExistingComment {
  id: number;
  author: string;
  authorUrl?: string;
  url: string;
  body: string;
  createdAt: string;
}

export interface ExistingReviewComment extends ExistingComment {
  threadId?: string;
  path: string;
  line?: number;
  originalLine?: number;
  side?: "LEFT" | "RIGHT";
  isResolved?: boolean;
}

export interface ResolveReviewThreadRequest extends PrRef {
  threadId: string;
}

export interface ResolveReviewThreadResponse extends PrRef {
  threadId: string;
  resolved: boolean;
}

export interface ExistingReviewSummary extends ExistingComment {
  state: string;
}

export interface SubmitReviewRequest extends PrRef {
  event: ReviewDecision;
  body?: string;
  comments: ReviewComment[];
}

export interface SubmitReviewResponse {
  url?: string;
  state?: string;
  submittedAt: string;
}

export interface ReplyConversationRequest extends PrRef {
  body: string;
  inReplyTo?: number;
}

export interface ReplyConversationResponse {
  comment: ExistingComment;
  replyMode: "issue-comment";
}

export interface ReviewProgress {
  prKey: string;
  checkedItems: string[];
  reviewedFiles: string[];
  ignoredRuleIds?: string[];
  manualChecks?: Record<string, ManualVerificationResult>;
  project?: string;
  issueProjects?: Record<string, string>;
  notes: string;
  lastReviewedAt?: string;
  updatedAt: string;
}

export interface ManualVerificationResult {
  item: string;
  status: "passed" | "failed";
  note: string;
  updatedAt: string;
}

export interface UpdateReviewProgressRequest {
  checkedItems?: string[];
  reviewedFiles?: string[];
  ignoredRuleIds?: string[];
  manualChecks?: Record<string, ManualVerificationResult>;
  project?: string;
  issueProjects?: Record<string, string>;
  notes?: string;
  lastReviewedAt?: string;
}

export interface RepoReviewRule {
  id: string;
  repository: string;
  title: string;
  body: string;
  tone: string;
  enabled: boolean;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRepoReviewRuleRequest {
  title: string;
  body: string;
  tone?: string;
  source?: string;
}

export interface UpdateRepoReviewRuleRequest {
  title?: string;
  body?: string;
  tone?: string;
  enabled?: boolean;
}
