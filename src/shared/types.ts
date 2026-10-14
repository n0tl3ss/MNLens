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

/** One step of the order in which a reviewer should read the diff. */
export interface ReadingGuideStep {
  path: string;
  /** Line range in the new file ("120-148"), empty when the whole file applies. */
  lines?: string;
  title: string;
  /** Plain-language explanation of what this part of the change does. */
  explanation: string;
  /** Why the reviewer should care about this step. */
  whyItMatters?: string;
}

/** An edge case the changed code can hit, with whether a test already exercises it. */
export interface EdgeCaseInsight extends ReviewInsight {
  covered: "yes" | "partial" | "no" | "unknown";
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
  caveats: string[];
  /** Suggested order to read the diff; see ReadingGuideStep. */
  readingGuide?: ReadingGuideStep[];
  /** Default values, default behaviour and implicit contracts the PR introduces or relies on. */
  assumptions?: ReviewInsight[];
  /** Boundary / error / concurrency scenarios the change can hit, with test coverage. */
  edgeCases?: EdgeCaseInsight[];
  /** Files the agent opened in the PR checkout beyond the diff (callers, defaults, tests); empty when it only saw the diff. */
  inspectedFiles?: string[];
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
  /** What changed versus the previous analysis of a different diff; see server/analysisDelta.ts. */
  delta?: AnalysisDelta;
}

/** Finding kinds the analysis-to-analysis delta is computed over. */
export type AnalysisDeltaKind = Extract<FindingKind, "risk" | "focus" | "assumption" | "edge-case">;

export interface AnalysisDeltaItem {
  kind: AnalysisDeltaKind;
  title: string;
  observation: string;
  severity: ReviewInsight["severity"];
  location?: string;
}

export interface AnalysisDeltaPersistingItem extends AnalysisDeltaItem {
  /** "title" when the titles matched after normalization, "observation" when only the observation text did. */
  matchedBy: "title" | "observation";
  /** Title the previous analysis used, when the agent reworded it. */
  previousTitle?: string;
  /** Severity in the previous analysis, when it changed. */
  previousSeverity?: ReviewInsight["severity"];
}

/**
 * Difference between two Deep Analyze runs on different diffs. Items are
 * matched by `verdictKey(kind, title)` first and by normalized observation
 * text second (see server/reviewMemory.ts), so a reworded title still counts
 * as the same finding. Human verdicts on persisting items are carried over.
 */
export interface AnalysisDelta {
  previousGeneratedAt: string;
  previousDiffHash: string;
  /** Findings of the previous analysis that the new one no longer raises. */
  resolved: AnalysisDeltaItem[];
  /** Findings present in both analyses (severity may have changed). */
  persisting: AnalysisDeltaPersistingItem[];
  /** Findings the new analysis raises for the first time. */
  added: AnalysisDeltaItem[];
  /** How many reviewer verdicts were copied onto reworded persisting items. */
  carriedVerdicts: number;
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
  /** Set when the other vendor's CLI was unavailable and the same vendor audited on a different tier instead. */
  fallbackReason?: string;
}

export interface SecondOpinionRequest extends PrRef {}

export interface ReviewInsight {
  /** `path:line` in the diff this item is about, when the agent could point at one. */
  location?: string;
  /** Short badge text rendered next to the severity (e.g. test coverage of an edge case). */
  meta?: string;
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

export interface GithubRateLimitResource {
  limit?: number;
  remaining?: number;
  used?: number;
  resetAt?: string;
}

/**
 * Headline fields describe the busiest metered resource (REST "core", GraphQL
 * or search); `resources` carries every budget GitHub reported so the UI can
 * explain which one is being consumed.
 */
export interface GithubRateLimitInfo extends GithubRateLimitResource {
  limited: boolean;
  resource?: string;
  resources?: Record<string, GithubRateLimitResource>;
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
  | "fix-implementation"
  | "fix-tests-qa"
  | "fix-final-review"
  | "fix-qa-assessment"
  | "fix-question"
  | "conflict-resolution"
  | "manual-check"
  | "second-opinion"
  | "acceptance-contract"
  | "review-draft"
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
  /**
   * Claude only: path to a JSON file in Claude Code's `mcpServers` format, passed as
   * `--mcp-config` on every run; the servers' tools are pre-approved for read-only runs.
   * CLAUDE.md and skills need no setting: Claude reads them from the checkout and ~/.claude.
   */
  claudeMcpConfig?: string;
  updatedAt: string;
}

export interface UpdateAgentSettingsRequest {
  agent?: AgentId;
  tiers?: Partial<Record<AgentId, Partial<Record<ModelTier, Partial<TierModel> & { effort?: string | null }>>>>;
  taskTiers?: Partial<Record<AgentTask, ModelTier>>;
  maxBudgetUsdPerRun?: number | null;
  claudeMcpConfig?: string | null;
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
  /** Exact local command (from the repository root) that exercises this criterion, when the agent could name one. */
  command?: string;
  /** Local verification run MNLens started for `command`; the job carries the result and decides "ran green" / "failed". */
  verification?: { jobId: string; command: string; startedAt: string };
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
// Review draft (where the comments go, and the final verdict)
// ---------------------------------------------------------------------------

export type SuggestedCommentKind = "blocking" | "important" | "suggestion" | "nit" | "question" | "praise";

export interface SuggestedReviewComment {
  id: string;
  path: string;
  /** Line on the given side of the diff; absent when the agent could not anchor the comment to a changed line. */
  line?: number;
  side: "LEFT" | "RIGHT";
  kind: SuggestedCommentKind;
  title: string;
  /** Comment text as the PR author would read it. */
  body: string;
  /** Why the reviewer should post this (not sent to GitHub). */
  rationale: string;
  /** Acceptance criterion this comment relates to, if any. */
  criterion?: string;
  /** Agent-supplied anchor that MNLens could not match to a changed line. */
  unanchored?: boolean;
  /** Exact replacement for the anchored (RIGHT-side) line; posted as a GitHub ```suggestion``` block the author can apply in one click. */
  suggestion?: string;
}

export interface ReviewDraft {
  prKey: string;
  diffHash: string;
  generatedAt: string;
  agent: AgentId;
  model: string;
  costUsd?: number;
  decision: ReviewDecision | "COMMENT";
  decisionRationale: string;
  /** The final review comment the agent would post (summary body of the GitHub review). */
  finalComment: string;
  comments: SuggestedReviewComment[];
  /** Ordered checklist the agent thinks the human must / should / may do before deciding. */
  mustDo: string[];
  shouldDo: string[];
  optional: string[];
}

export interface ReviewDraftRequest extends PrRef {
  force?: boolean;
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
  kind: FindingKind;
  title: string;
  observation?: string;
  verdict: FindingVerdict;
  reason?: string;
  at: string;
  /** Who recorded the verdict (machine/user id in a shared team folder). */
  member?: string;
  /** For draft-comment verdicts: the comment kind the agent assigned (blocking, nit, ...). */
  commentKind?: SuggestedCommentKind;
  /** Title of the finding this verdict was copied from when a re-analysis reworded it; carried entries do not count toward calibration. */
  carriedFrom?: string;
}

export type FindingKind = "evidence" | "focus" | "risk" | "assumption" | "edge-case" | "test" | "criterion" | "draft-comment";

export interface RecordFindingFeedbackRequest extends PrRef {
  kind: FindingFeedback["kind"];
  title: string;
  observation?: string;
  verdict: FindingVerdict | null;
  reason?: string;
  commentKind?: SuggestedCommentKind;
}

/** How often the agent's suggested review comments were kept vs dismissed in a repository. */
export interface DraftCommentAccuracy {
  kept: number;
  dismissed: number;
  byKind: Partial<Record<SuggestedCommentKind, { kept: number; dismissed: number }>>;
  /** The newest `window` verdicts, so the badge can show whether accuracy is improving. */
  recent?: { kept: number; dismissed: number; window: number };
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
  draftComments: DraftCommentAccuracy;
  /** Distinct reviewers who contributed verdicts (1 when memory is local only). */
  members: number;
  /** True when verdicts are read from / written to the shared team folder. */
  shared: boolean;
}

// ---------------------------------------------------------------------------
// Team sharing (shared folder for rules + review memory; repo-committed rules)
// ---------------------------------------------------------------------------

export interface TeamSettings {
  /** Shared folder (git checkout, Dropbox, network drive). Undefined = local only. */
  dir?: string;
  updatedAt: string;
}

export interface TeamStatus {
  dir?: string;
  /** Where the folder setting came from. */
  source: "env" | "settings" | "none";
  exists: boolean;
  writable: boolean;
  /** This machine's id inside the team folder (memory files are per member to avoid write conflicts). */
  memberId: string;
  repositories: string[];
  error?: string;
}

export interface UpdateTeamSettingsRequest {
  /** New folder path, or null to go back to local-only. */
  dir?: string | null;
}

export interface RepoRulesExport {
  /** Path inside the repository where maintainers commit the file. */
  path: string;
  content: string;
  rules: number;
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
  /** What a finished run says: ran green, ran and found a problem, or never got to run (wrong JDK, offline). */
  outcome?: "passed" | "test-failed" | "blocked";
  /** Why a blocked run could not start, in one sentence. */
  blockedReason?: string;
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
    | "implementation"
    | "tests-qa"
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

export interface AnalyzeRequest {
  prs: PrRef[];
  force?: boolean;
  mode?: "fast" | "deep";
}

export interface AnalyzeResponse {
  jobs: Job[];
}

/** GitHub review events. COMMENT is the only event GitHub accepts on your own PR (self-review). */
export type ReviewDecision = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

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
  /** Where the rule lives: this machine, the shared team folder, or committed in the repository (`.mnlens/review-rules.json`). */
  origin?: "local" | "team" | "repository";
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
