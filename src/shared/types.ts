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
}

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
}

export interface SetupStatus {
  checkedAt: string;
  platform: string;
  ready: boolean;
  dependencies: DependencyCheck[];
}

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
