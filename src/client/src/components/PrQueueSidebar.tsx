import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitPullRequest,
  Moon,
  RefreshCw,
  Search,
  Sparkles,
  Sun,
  X
} from "lucide-react";
import type { AuthStatus, FixJob, Job, PrListItem, QueueName } from "../../../shared/types";
import type { ReviewScore } from "../reviewScoring";
import type { PrRepositoryGroup, PrSortField, SortDirection } from "../reviewHelpers";
import { hasAnalysisSignal, sortDirectionLabel, sortFieldLabel, triageForPr } from "../reviewHelpers";
import type { Tab } from "../reviewTypes";
import { AuthBanner } from "./AuthBanner";
import type { WorkActivityItem } from "./WorkActivityPanel";
import { WorkActivityPanel } from "./WorkActivityPanel";
import { AuthorLink, Badge, plural, relativeDate } from "./uiBits";
import "./prQueueSidebar.css";

const sortFields: PrSortField[] = ["date", "name", "score"];
const sortDirections: SortDirection[] = ["desc", "asc"];
const typeLabels = ["all", "feature", "bug", "improvement", "refactor", "docs", "test", "chore", "unknown"] as const;

export type PrTypeFilter = (typeof typeLabels)[number];
export type BulkAnalyzeMode = "fast" | "deep";

export function PrQueueSidebar({
  auth,
  authTokenInput,
  savingAuthToken,
  busy,
  cacheText,
  collapsedRepos,
  expandedPrRows,
  fixJobs,
  includeMine,
  mobileCloseVisible,
  query,
  queue,
  repoFilter,
  repos,
  selectedKey,
  selectedReviewScore,
  sortDirection,
  sortField,
  theme,
  typeFilter,
  unanalyzedVisibleCount,
  bulkAnalyzeMode,
  visibleAnalysisBatch,
  visiblePrGroups,
  visiblePrs,
  workActivity,
  latestJobForPr,
  onAnalyzeVisible,
  onBulkAnalyzeModeChange,
  onCloseMobile,
  onIncludeMineChange,
  onQueryChange,
  onQueueChange,
  onRefreshAuth,
  onRefreshPrs,
  onRepoFilterChange,
  onSaveGithubToken,
  onCancelActivity,
  onCancelQueuedActivity,
  onClearAllData,
  onExportData,
  onSelectActivity,
  onSelectPr,
  onSortDirectionChange,
  onSortFieldChange,
  onThemeToggle,
  onTogglePrRow,
  onToggleRepoGroup,
  onTokenChange,
  onTypeFilterChange,
  readinessForPr,
  scoreForPrList,
}: {
  auth?: AuthStatus;
  authTokenInput: string;
  savingAuthToken: boolean;
  busy: boolean;
  cacheText: string;
  collapsedRepos: Record<string, boolean>;
  expandedPrRows: Record<string, boolean>;
  fixJobs: Record<string, FixJob>;
  includeMine: boolean;
  mobileCloseVisible: boolean;
  query: string;
  queue: QueueName;
  repoFilter: string;
  repos: string[];
  selectedKey?: string;
  selectedReviewScore?: ReviewScore;
  sortDirection: SortDirection;
  sortField: PrSortField;
  theme: "light" | "dark";
  typeFilter: PrTypeFilter;
  unanalyzedVisibleCount: number;
  bulkAnalyzeMode: BulkAnalyzeMode;
  visibleAnalysisBatch: PrListItem[];
  visiblePrGroups: PrRepositoryGroup[];
  visiblePrs: PrListItem[];
  workActivity: WorkActivityItem[];
  latestJobForPr: (key: string) => Job | undefined;
  onAnalyzeVisible: () => void;
  onBulkAnalyzeModeChange: (mode: BulkAnalyzeMode) => void;
  onCloseMobile: () => void;
  onIncludeMineChange: (include: boolean) => void;
  onQueryChange: (query: string) => void;
  onQueueChange: (queue: QueueName) => void;
  onRefreshAuth: () => void;
  onRefreshPrs: () => void;
  onRepoFilterChange: (repo: string) => void;
  onSaveGithubToken: () => void;
  onCancelActivity: (item: WorkActivityItem) => void;
  onCancelQueuedActivity: () => void;
  onClearAllData: () => void;
  onExportData: () => void;
  onSelectActivity: (item: WorkActivityItem) => void;
  onSelectPr: (pr: PrListItem) => void;
  onSortDirectionChange: (direction: SortDirection) => void;
  onSortFieldChange: (field: PrSortField) => void;
  onThemeToggle: () => void;
  onTogglePrRow: (key: string) => void;
  onToggleRepoGroup: (repository: string) => void;
  onTokenChange: (token: string) => void;
  onTypeFilterChange: (type: PrTypeFilter) => void;
  readinessForPr: (pr: PrListItem, context?: { job?: Job; fixJobs?: FixJob[] }) => { label: string; tone: string };
  scoreForPrList: (pr: PrListItem) => { score: ReviewScore; estimated: boolean; available: boolean };
}) {
  return (
    <aside className="sidebar">
      <header className="app-header">
        <div className="brand-lockup">
          <img src="/mnlens-logo.png?v=5" alt="" />
          <div>
            <h1>MNLens</h1>
            <p>{cacheText || "Human-led GitHub review queue"}</p>
          </div>
        </div>
        <div className="header-actions">
          {mobileCloseVisible && (
            <button className="icon-button mobile-sidebar-close" onClick={onCloseMobile} title="Close review queue">
              <X size={18} />
            </button>
          )}
          <button className="icon-button" onClick={onThemeToggle} title={theme === "dark" ? "Use light theme" : "Use dark theme"}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="icon-button" onClick={onRefreshPrs} title="Refresh PRs">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <AuthBanner
        auth={auth}
        token={authTokenInput}
        saving={savingAuthToken}
        onTokenChange={onTokenChange}
        onSave={onSaveGithubToken}
        onRefresh={onRefreshAuth}
      />
      <WorkActivityPanel activity={workActivity} onSelectActivity={onSelectActivity} onCancelActivity={onCancelActivity} onCancelQueuedActivity={onCancelQueuedActivity} />

      <div className="controls">
        <Segmented<QueueName>
          value={queue}
          values={["all", "assigned", "review-requested", "reviewed"]}
          onChange={onQueueChange}
        />
        <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search PRs" />
        </label>
        <select value={repoFilter} onChange={(event) => onRepoFilterChange(event.target.value)}>
          {repos.map((repo) => (
            <option key={repo} value={repo}>
              {repo === "all" ? "All repositories" : repo}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value as PrTypeFilter)}>
          {typeLabels.map((type) => (
            <option key={type} value={type}>
              {type === "all" ? "All AI types" : type}
            </option>
          ))}
        </select>
        <div className="sort-controls">
          <select value={sortField} onChange={(event) => onSortFieldChange(event.target.value as PrSortField)} aria-label="Sort PRs by">
            {sortFields.map((field) => (
              <option key={field} value={field}>
                Sort by {sortFieldLabel(field)}
              </option>
            ))}
          </select>
          <select value={sortDirection} onChange={(event) => onSortDirectionChange(event.target.value as SortDirection)} aria-label="Sort direction">
            {sortDirections.map((direction) => (
              <option key={direction} value={direction}>
                {sortDirectionLabel(sortField, direction)}
              </option>
            ))}
          </select>
        </div>
        <label className="check-control">
          <input type="checkbox" checked={includeMine} onChange={(event) => onIncludeMineChange(event.target.checked)} />
          Include my PRs
        </label>
      </div>

      <div className="bulk-actions">
        <div className="analyze-mode-switch" role="group" aria-label="Visible analysis depth">
          <button type="button" className={bulkAnalyzeMode === "fast" ? "active" : ""} onClick={() => onBulkAnalyzeModeChange("fast")}>
            Fast
          </button>
          <button type="button" className={bulkAnalyzeMode === "deep" ? "active" : ""} onClick={() => onBulkAnalyzeModeChange("deep")}>
            Deep
          </button>
        </div>
        <button disabled={visibleAnalysisBatch.length === 0} onClick={onAnalyzeVisible}>
          <Sparkles size={16} />
          {bulkAnalyzeMode === "deep" ? "Deep Analyze visible" : "Fast Analyze visible"}
          {unanalyzedVisibleCount > 0 && <span>{unanalyzedVisibleCount} new first</span>}
        </button>
        <button type="button" onClick={onExportData}>Export data</button>
        <button type="button" className="danger" onClick={onClearAllData}>Clear local data</button>
      </div>

      <section className="pr-list" aria-busy={busy}>
        {visiblePrGroups.map((group) => (
          <PrRepositorySection
            key={group.repository}
            collapsed={collapsedRepos[group.repository] ?? false}
            expandedPrRows={expandedPrRows}
            fixJobs={fixJobs}
            group={group}
            latestJobForPr={latestJobForPr}
            readinessForPr={readinessForPr}
            scoreForPrList={scoreForPrList}
            selectedKey={selectedKey}
            selectedReviewScore={selectedReviewScore}
            onSelectPr={onSelectPr}
            onTogglePrRow={onTogglePrRow}
            onToggleRepoGroup={onToggleRepoGroup}
          />
        ))}
        {!busy && visiblePrs.length === 0 && <p className="empty">No PRs match the current filters.</p>}
        {busy && <p className="empty">Loading PRs...</p>}
      </section>
    </aside>
  );
}

function PrRepositorySection({
  collapsed,
  expandedPrRows,
  fixJobs,
  group,
  latestJobForPr,
  readinessForPr,
  scoreForPrList,
  selectedKey,
  selectedReviewScore,
  onSelectPr,
  onTogglePrRow,
  onToggleRepoGroup
}: {
  collapsed: boolean;
  expandedPrRows: Record<string, boolean>;
  fixJobs: Record<string, FixJob>;
  group: PrRepositoryGroup;
  latestJobForPr: (key: string) => Job | undefined;
  readinessForPr: (pr: PrListItem, context?: { job?: Job; fixJobs?: FixJob[] }) => { label: string; tone: string };
  scoreForPrList: (pr: PrListItem) => { score: ReviewScore; estimated: boolean; available: boolean };
  selectedKey?: string;
  selectedReviewScore?: ReviewScore;
  onSelectPr: (pr: PrListItem) => void;
  onTogglePrRow: (key: string) => void;
  onToggleRepoGroup: (repository: string) => void;
}) {
  return (
    <div className={`pr-repo-group ${collapsed ? "collapsed" : ""}`}>
      <button className="pr-repo-heading" onClick={() => onToggleRepoGroup(group.repository)} title={collapsed ? "Show repository PRs" : "Temporarily collapse repository"}>
        {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        <strong>{group.repository}</strong>
        <span>{plural(group.items.length, "PR")}</span>
        {collapsed && <Badge tone="neutral">hidden</Badge>}
        {group.unanalyzed > 0 && <Badge tone="queue">{group.unanalyzed} unread</Badge>}
      </button>
      {!collapsed && group.items.map((pr) => {
        const rowJob = latestJobForPr(pr.key);
        const rowFixJobs = Object.values(fixJobs).filter((job) => job.prKey === pr.key);
        const readiness = readinessForPr(pr, { job: rowJob, fixJobs: rowFixJobs });
        const triage = triageForPr(pr, rowJob, rowFixJobs);
        const rowScore = pr.key === selectedKey && selectedReviewScore ? { score: selectedReviewScore, estimated: false, available: true } : scoreForPrList(pr);
        const score = rowScore.score;
        const expanded = expandedPrRows[pr.key] ?? false;
        return (
          <article key={pr.key} className={`pr-row ${pr.key === selectedKey ? "selected" : ""} ${expanded ? "expanded" : ""} ${triage.tone}`}>
            <div className="pr-row-top">
              <button className="pr-row-select" onClick={() => onSelectPr(pr)}>
                <span className="row-title">{pr.title}</span>
                <span className="row-triage">
                  <Badge tone={triage.tone}>{triage.label}</Badge>
                  <span>{triage.nextAction}</span>
                </span>
              </button>
              <span
                className={`row-score ${rowScore.available ? score.tone : "unavailable"} ${rowScore.estimated && rowScore.available ? "estimated" : ""}`}
                title={rowScore.available ? (rowScore.estimated ? "Estimated from fast/list data. Open this PR and run Deep Analyze for full review guidance." : `${score.score}/100, ${score.label}`) : "Run Fast Analyze visible to calculate queue scores."}
              >
                {rowScore.available ? (
                  <>
                  {rowScore.estimated && <em>{pr.analysisMode === "fast" ? "F" : "~"}</em>}
                    {score.score}
                  </>
                ) : (
                  "N/A"
                )}
              </span>
              <button className="icon-button row-expand" onClick={() => onTogglePrRow(pr.key)} title={expanded ? "Collapse PR details" : "Expand PR details"}>
                {expanded ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
              </button>
            </div>
            {expanded && (
              <div className="pr-row-details">
                <span className="row-repo">
                  <GitPullRequest size={15} />
                  <strong>{pr.repository}</strong>
                  <em>#{pr.number}</em>
                </span>
                <span className="row-meta">
                  <span>by <AuthorLink name={pr.author} url={pr.authorUrl} /></span>
                  <span>{relativeDate(pr.updatedAt)}</span>
                  {typeof pr.changedFiles === "number" && <span>{pr.changedFiles} files</span>}
                  <span>{plural(pr.commentsCount, "comment")}</span>
                  <span>{score.effort.label}, {score.effort.minutes}</span>
                </span>
                <span className="row-next-action">
                  <strong>Next:</strong> {triage.nextAction}
                  <em>{triage.reason}</em>
                </span>
                <span className="row-badges">
                  <Badge tone={readiness.tone}>{readiness.label}</Badge>
                  <Badge tone={toneForType(pr.aiType)}>{pr.aiType ?? "unread"}</Badge>
                  <Badge tone={toneForReviewDecision(pr.reviewDecision)}>{reviewDecisionLabel(pr.reviewDecision)}</Badge>
                  {pr.queues.map((item) => (
                    <Badge key={item} tone="queue">{item}</Badge>
                  ))}
                  {pr.labels.slice(0, 3).map((label) => (
                    <Badge key={label} tone="label">{label}</Badge>
                  ))}
                </span>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function Segmented<T extends string>({ value, values, onChange }: { value: T; values: T[]; onChange: (value: T) => void }) {
  return (
    <div className="segmented">
      {values.map((item) => (
        <button key={item} className={value === item ? "active" : ""} onClick={() => onChange(item)}>
          {queueLabel(item)}
        </button>
      ))}
    </div>
  );
}

function queueLabel(value: string): string {
  if (value === "review-requested") return "review requested";
  return value;
}

function toneForType(type?: string): string {
  if (type === "bug") return "danger";
  if (type === "feature") return "feature";
  if (type === "improvement") return "improvement";
  return "neutral";
}

function toneForReviewDecision(decision?: string): string {
  if (decision === "APPROVED") return "added";
  if (decision === "CHANGES_REQUESTED") return "danger";
  if (decision === "REVIEW_REQUIRED") return "queue";
  return "review-needed";
}

function reviewDecisionLabel(decision?: string): string {
  if (decision === "APPROVED") return "approved";
  if (decision === "CHANGES_REQUESTED") return "changes requested";
  if (decision === "REVIEW_REQUIRED") return "review required";
  return "not reviewed";
}
