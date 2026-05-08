import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalysisResult,
  CiCheck,
  FixJob,
  GithubProject,
  Job,
  PrDetail,
  PrListItem,
  QueueName,
  RebasePrResponse,
  ReviewComment,
  ReviewDecision,
  EditorKind,
  ReviewProgress,
  RepoReviewRule,
  RepositoryBranch,
  VerificationJob
} from "../../shared/types";
import {
  attachGithubProject,
  analyzePrs,
  askFix,
  cancelAnalysis,
  cancelFix,
  cancelVerification,
  clearAllLocalData,
  clearCache,
  confirmRebaseDefault,
  createRepoRule,
  downloadCacheBundle,
  getActiveFixJobs,
  getAnalysis,
  getCacheStats,
  getCiChecks,
  getCiLog,
  getFixJob,
  getFixLiveDiff,
  getFixJobs,
  getGithubProjects,
  getJob,
  getPrDetail,
  getPrs,
  getProgress,
  getRepositoryBranches,
  getRepoRules,
  getVerificationJob,
  getVerificationJobs,
  openEditor,
  rebasePrDefault,
  replyConversation,
  retryFix,
  runManualVerification,
  runVerification,
  pushFix,
  startFix,
  submitReview,
  updatePrTargetBranch,
  updateRepoRule,
  updateProgress
} from "./api";
import { type DraftReviewComment } from "./components/CommentTab";
import { DetailTab } from "./components/DetailTab";
import { DetailPaneChrome } from "./components/DetailPaneChrome";
import { PrDetailHeader } from "./components/PrDetailHeader";
import { ReviewDialog } from "./components/ReviewDialog";
import { PrQueueSidebar, type PrTypeFilter } from "./components/PrQueueSidebar";
import { RebasePreviewPanel } from "./components/RebasePreviewPanel";
import { ReviewTabs } from "./components/ReviewTabs";
import { SetupScreen } from "./components/SetupScreen";
import { workActivityForPrs, type WorkActivityItem } from "./components/WorkActivityPanel";
import { buildOwnerImproveInstructions } from "./ownerImproveInstructions";
import { isReviewPlanComplete } from "./planHelpers";
import { buildPrQueueView } from "./prQueueView";
import {
  isAnalysisInFlight,
  isDocsPath,
  isLikelyDocsOnlyListItem,
  isSimplePr,
  isTestPath,
  latestPushedFix,
  sameSidebarScore,
  type PrSortField,
  type SortDirection
} from "./reviewHelpers";
import { readinessForPr, reviewScoreForPr, type ReviewScore } from "./reviewScoring";
import { buildHandoffMarkdown, finalReviewRecommendation } from "./reviewRecommendation";
import type { Tab } from "./reviewTypes";
import {
  ciSummary,
  toneForCi
} from "./verificationHelpers";
import { useJobPolling } from "./useJobPolling";
import { useSetupAuth } from "./useSetupAuth";

type Theme = "light" | "dark";
const backgroundPrRefreshMs = 2 * 60_000;

export function App() {
  const [queue, setQueue] = useState<QueueName>("all");
  const [includeMine, setIncludeMine] = useState(false);
  const [prs, setPrs] = useState<PrListItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [detail, setDetail] = useState<PrDetail | undefined>();
  const [analysis, setAnalysis] = useState<AnalysisResult | undefined>();
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [tab, setTab] = useState<Tab>("overview");
  const [typeFilter, setTypeFilter] = useState<PrTypeFilter>("all");
  const [repoFilter, setRepoFilter] = useState("all");
  const [sortField, setSortField] = useState<PrSortField>(() => (localStorage.getItem("mnlens-pr-sort-field") as PrSortField) || "date");
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => (localStorage.getItem("mnlens-pr-sort-direction") as SortDirection) || "desc");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [cacheText, setCacheText] = useState("");
  const [reviewComments, setReviewComments] = useState<Record<string, DraftReviewComment[]>>({});
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [reviewBody, setReviewBody] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [progress, setProgress] = useState<ReviewProgress | undefined>();
  const [repoRules, setRepoRules] = useState<RepoReviewRule[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, string | undefined>>({});
  const [verificationJobs, setVerificationJobs] = useState<Record<string, VerificationJob>>({});
  const [fixJobs, setFixJobs] = useState<Record<string, FixJob>>({});
  const [fullReviewScores, setFullReviewScores] = useState<Record<string, ReviewScore>>({});
  const [ciChecks, setCiChecks] = useState<Record<string, CiCheck[]>>({});
  const [ciLogs, setCiLogs] = useState<Record<string, string>>({});
  const [ciLoading, setCiLoading] = useState<Record<string, boolean>>({});
  const [rebasing, setRebasing] = useState(false);
  const [refreshingSelected, setRefreshingSelected] = useState(false);
  const [rebasePreview, setRebasePreview] = useState<RebasePrResponse | undefined>();
  const [expandedPrRows, setExpandedPrRows] = useState<Record<string, boolean>>({});
  const [collapsedRepos, setCollapsedRepos] = useState<Record<string, boolean>>({});
  const [openingEditor, setOpeningEditor] = useState<EditorKind | undefined>();
  const [askingFixId, setAskingFixId] = useState<string | undefined>();
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("pra-theme") === "light" ? "light" : "dark"));
  const [attentionMode, setAttentionMode] = useState(() => localStorage.getItem("pra-attention-mode") === "true");
  const [mobileQueueOpen, setMobileQueueOpen] = useState(false);
  const [highlightedFixJobId, setHighlightedFixJobId] = useState<string | undefined>();
  const [openConversationReplies, setOpenConversationReplies] = useState<Record<number, boolean>>({});
  const [conversationReplyDrafts, setConversationReplyDrafts] = useState<Record<number, string>>({});
  const [postingConversationReply, setPostingConversationReply] = useState<Record<number, boolean>>({});
  const [githubProjects, setGithubProjects] = useState<GithubProject[]>([]);
  const [githubProjectsError, setGithubProjectsError] = useState<string | undefined>();
  const [projectAttachBusy, setProjectAttachBusy] = useState(false);
  const [targetBranches, setTargetBranches] = useState<Record<string, RepositoryBranch[]>>({});
  const [targetChanging, setTargetChanging] = useState(false);
  const autoRefreshingRef = useRef(false);
  const {
    auth,
    setupStatus,
    betaLimitations,
    setupLoading,
    setupError,
    authTokenInput,
    savingAuthToken,
    shouldShowSetup,
    refreshAuth,
    refreshSetupStatus,
    saveGithubToken,
    setAuthTokenInput,
    continueSetup
  } = useSetupAuth({ onError: setError, onNotice: setNotice });

  const selected = prs.find((pr) => pr.key === selectedKey);
  const selectedDetail = detail?.key === selectedKey ? detail : undefined;
  const selectedComments = selectedKey ? (reviewComments[selectedKey] ?? []) : [];
  const selectedAnalysisJobs = Object.values(jobs).filter((job) => job.prKey === selectedKey);
  const selectedVerificationJobs = Object.values(verificationJobs).filter((job) => job.prKey === selectedKey);
  const selectedFixJobs = Object.values(fixJobs).filter((job) => job.prKey === selectedKey);
  const selectedCiChecks = selectedKey ? (ciChecks[selectedKey] ?? []) : [];
  const selectedIsOwnedByCurrentUser = Boolean(selected && auth?.username && selected.author.toLowerCase() === auth.username.toLowerCase());
  const selectedFixRunning = selectedFixJobs.some((job) => job.status === "queued" || job.status === "running");
  const workActivity = workActivityForPrs(prs, Object.values(jobs), Object.values(verificationJobs), Object.values(fixJobs));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pra-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("pra-attention-mode", attentionMode ? "true" : "false");
  }, [attentionMode]);

  useEffect(() => {
    localStorage.setItem("mnlens-pr-sort-field", sortField);
    localStorage.setItem("mnlens-pr-sort-direction", sortDirection);
  }, [sortField, sortDirection]);

  useEffect(() => {
    void refreshPrs();
  }, [queue, includeMine]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden" || autoRefreshingRef.current) return;
      autoRefreshingRef.current = true;
      void refreshPrListSnapshot({ silent: true, refreshSelected: true }).finally(() => {
        autoRefreshingRef.current = false;
      });
    }, backgroundPrRefreshMs);
    return () => window.clearInterval(timer);
  }, [queue, includeMine, selectedKey]);

  useEffect(() => {
    if (!selected) {
      setDetail(undefined);
      setAnalysis(undefined);
      setRebasePreview(undefined);
      return;
    }
    setRebasePreview(undefined);
    void loadDetail(selected);
  }, [selectedKey]);

  useJobPolling(jobs, pollJob, 2000);
  useJobPolling(verificationJobs, pollVerificationJob, 2500);
  useJobPolling(fixJobs, pollFixJob, 3000);

  useEffect(() => {
    void refreshActiveFixJobs();
    const timer = window.setInterval(() => void refreshActiveFixJobs(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const repos = useMemo(() => ["all", ...Array.from(new Set(prs.map((pr) => pr.repository))).sort()], [prs]);
  const { visiblePrs, visiblePrGroups, visibleAnalysisBatch, unanalyzedVisibleCount, latestJobForPr, scoreForPrList } =
    useMemo(
      () =>
        buildPrQueueView({
          prs,
          jobs,
          fixJobs,
          fullReviewScores,
          typeFilter,
          repoFilter,
          sortField,
          sortDirection,
          query,
          collapsedRepos
        }),
      [prs, jobs, fixJobs, fullReviewScores, typeFilter, repoFilter, sortField, sortDirection, query, collapsedRepos]
    );

  function toggleRepoGroup(repository: string) {
    setCollapsedRepos((current) => ({
      ...current,
      [repository]: !current[repository]
    }));
  }

  async function refreshPrs() {
    await refreshPrListSnapshot({ silent: false, refreshSelected: false });
  }

  async function refreshPrListSnapshot({ silent, refreshSelected }: { silent: boolean; refreshSelected: boolean }) {
    if (!silent) setBusy(true);
    setError(undefined);
    if (!silent) setNotice(undefined);
    try {
      const next = await getPrs(queue, includeMine);
      setPrs(next);
      setSelectedKey((current) => current ?? next[0]?.key);
      const stats = await getCacheStats();
      setCacheText(`${stats.prCount} PR snapshots, ${stats.analysisCount} analyses`);
      if (refreshSelected && selectedKey) {
        const freshSelected = next.find((pr) => pr.key === selectedKey);
        if (freshSelected) await loadDetail(freshSelected, true, true);
      }
    } catch (err) {
      if (!silent) setError(messageOf(err));
    } finally {
      if (!silent) setBusy(false);
    }
  }

  async function loadDetail(pr: PrListItem, preserveExisting = false, suppressErrors = false) {
    setError(undefined);
    if (!preserveExisting) {
      setDetail(undefined);
      setAnalysis(undefined);
    }
    try {
      const [next, cachedAnalysis, savedProgress, savedVerificationJobs, savedFixJobs, nextCiChecks, savedRepoRules, nextBranches] = await Promise.all([
        getPrDetail(pr),
        getAnalysis(pr.key),
        getProgress(pr.key),
        getVerificationJobs(pr.key),
        getFixJobs(pr.key),
        getCiChecks(pr),
        getRepoRules(pr.owner, pr.repo),
        getRepositoryBranches(pr.owner, pr.repo).catch(() => [] as RepositoryBranch[])
      ]);
      const nextGithubProjects = await getGithubProjects(pr.owner).catch((error) => {
        setGithubProjectsError(messageOf(error));
        return [];
      });
      if (nextGithubProjects.length > 0) setGithubProjectsError(undefined);
      setDetail(next);
      setProgress(savedProgress);
      setRepoRules(savedRepoRules);
      setGithubProjects(nextGithubProjects);
      setTargetBranches((current) => ({ ...current, [next.repository]: nextBranches }));
      setCiChecks((current) => ({ ...current, [pr.key]: nextCiChecks }));
      setVerificationJobs((current) => ({
        ...current,
        ...Object.fromEntries(savedVerificationJobs.map((job) => [job.id, job]))
      }));
      setFixJobs((current) => ({
        ...current,
        ...Object.fromEntries(savedFixJobs.map((job) => [job.id, job]))
      }));
      setPrs((current) =>
        current.map((item) =>
          item.key === next.key
            ? {
                ...item,
                title: next.title,
                url: next.url,
                author: next.author,
                authorUrl: next.authorUrl,
                labels: next.labels,
                state: next.state,
                isDraft: next.isDraft,
                updatedAt: next.updatedAt,
                commentsCount: next.commentsCount,
                changedFiles: next.changedFiles,
                reviewDecision: next.reviewDecision,
                mergeStateStatus: next.mergeStateStatus,
                ...(cachedAnalysis
                  ? {
                      aiType: cachedAnalysis.type,
                      aiRiskCount: cachedAnalysis.risks.length,
                      aiTestsCount: cachedAnalysis.testsToCheck.length,
                      analysisStatus: "done" as const,
                      analysisUpdatedAt: cachedAnalysis.generatedAt
                    }
                  : {})
              }
            : item
        )
      );
      if (cachedAnalysis && cachedAnalysis.diffHash === next.diffHash) setAnalysis(cachedAnalysis);
      if (!cachedAnalysis || cachedAnalysis.diffHash !== next.diffHash) setAnalysis(undefined);
    } catch (err) {
      if (!suppressErrors) setError(messageOf(err));
    }
  }

  async function refreshSelectedData() {
    if (!selected) {
      await refreshPrs();
      return;
    }
    setRefreshingSelected(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const [nextPrs, stats] = await Promise.all([getPrs(queue, includeMine), getCacheStats()]);
      setPrs(nextPrs);
      setCacheText(`${stats.prCount} PR snapshots, ${stats.analysisCount} analyses`);
      const freshSelected = nextPrs.find((pr) => pr.key === selected.key) ?? selected;
      await loadDetail(freshSelected, true);
      setNotice("PR data refreshed.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setRefreshingSelected(false);
    }
  }

  async function startAnalysis(batch: PrListItem[], force = false, mode: "fast" | "deep" = "deep") {
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await analyzePrs(batch.map(({ owner, repo, number }) => ({ owner, repo, number })), force, mode);
      setJobs((current) => ({ ...current, ...Object.fromEntries(response.jobs.map((job) => [job.id, job])) }));
      response.jobs.forEach((job) => void pollJob(job.id));
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function pollJob(id: string) {
    try {
      const job = await getJob(id);
      setJobs((current) => ({ ...current, [id]: job }));
      if (job.status === "done" && (job.result || job.fast)) {
        if (job.result && job.prKey === selectedKey) setAnalysis(job.result);
        setPrs((current) =>
          current.map((pr) =>
            pr.key === job.prKey
              ? {
                  ...pr,
                  ...(job.fast ?? {}),
                  ...(job.result
                    ? {
                        aiType: job.result.type,
                        analysisStatus: "done",
                        analysisUpdatedAt: job.updatedAt,
                        analysisMode: "deep" as const,
                        aiRiskCount: job.result.risks.length,
                        aiTestsCount: job.result.testsToCheck.length
                      }
                    : {})
                }
              : pr
          )
        );
      }
      if (job.status === "failed") setError(job.error);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function cancelWorkActivity(item: WorkActivityItem) {
    setError(undefined);
    setNotice(undefined);
    try {
      if (item.kind === "Codex fix") {
        const job = await cancelFix(item.jobId);
        setFixJobs((current) => ({ ...current, [job.id]: job }));
        setNotice("Codex Fix session cancellation requested.");
        return;
      }
      if (item.kind === "Local test") {
        const job = await cancelVerification(item.jobId);
        setVerificationJobs((current) => ({ ...current, [job.id]: job }));
        setNotice("Local verification cancellation requested.");
        return;
      }
      const job = await cancelAnalysis(item.jobId);
      setJobs((current) => ({ ...current, [job.id]: job }));
      setNotice("Analysis job cancellation requested.");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function cancelQueuedWorkActivity() {
    const queued = workActivity.filter((item) => item.status === "queued");
    if (queued.length === 0) return;
    setError(undefined);
    try {
      await Promise.all(queued.map((item) => cancelWorkActivity(item)));
      setNotice(`Cancellation requested for ${queued.length} queued job${queued.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function startVerification(command: string) {
    if (!selected) return;
    setError(undefined);
    setNotice(undefined);
    try {
      const job = await runVerification({
        owner: selected.owner,
        repo: selected.repo,
        number: selected.number,
        command
      });
      setVerificationJobs((current) => ({ ...current, [job.id]: job }));
      void pollVerificationJob(job.id);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function startManualVerification(item: string, id: string) {
    if (!selected) return;
    setError(undefined);
    setNotice(undefined);
    try {
      const job = await runManualVerification({
        owner: selected.owner,
        repo: selected.repo,
        number: selected.number,
        item,
        id
      });
      setVerificationJobs((current) => ({ ...current, [job.id]: job }));
      void pollVerificationJob(job.id);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function pollVerificationJob(id: string) {
    try {
      const job = await getVerificationJob(id);
      setVerificationJobs((current) => ({ ...current, [id]: job }));
      if (job.status === "failed") setError([job.error, job.stderr, job.stdout].filter(Boolean).join("\n\n"));
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function startCodexFix(instructions?: string, baseJobId?: string, source?: string) {
    if (!selected) return;
    setError(undefined);
    setNotice(undefined);
    try {
      const job = await startFix({
        owner: selected.owner,
        repo: selected.repo,
        number: selected.number,
        instructions,
        source,
        baseJobId,
        draftComments: selectedComments.filter((comment) => comment.body.trim().length > 0)
      });
      setFixJobs((current) => ({ ...current, [job.id]: job }));
      void pollFixJob(job.id);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function startOwnerImprovePr() {
    if (!selected) return;
    setTab("fix");
    await startCodexFix(
      buildOwnerImproveInstructions(selected, activeDetailAnalysis, selectedReviewScore, selectedCiChecks, selectedVerificationJobs, selectedFixJobs, selectedComments),
      undefined,
      "Owner action / Improve PR score"
    );
  }

  async function pollFixJob(id: string) {
    try {
      const job = await getFixJob(id);
      let nextJob = job;
      if (job.repoDir && (job.status === "queued" || job.status === "running")) {
        const live = await getFixLiveDiff(id).catch(() => undefined);
        if (live) nextJob = { ...job, diff: live.diff, repoDir: live.repoDir ?? job.repoDir, updatedAt: live.updatedAt };
      }
      setFixJobs((current) => ({ ...current, [id]: nextJob }));
      if (job.status === "failed") setError([job.error, job.stderr, job.stdout].filter(Boolean).join("\n\n"));
      if (job.status === "done") setNotice(job.pushed ? `Codex fix pushed${job.commitSha ? ` as ${job.commitSha}` : ""}.` : "Fix preview ready for review.");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function refreshActiveFixJobs() {
    try {
      const active = await getActiveFixJobs();
      if (active.length === 0) return;
      setFixJobs((current) => ({ ...current, ...Object.fromEntries(active.map((job) => [job.id, job])) }));
    } catch {
      // Keep the global activity indicator best-effort so a transient cache/API error does not block review work.
    }
  }

  async function openSelectedInEditor(editor: EditorKind) {
    if (!selected) return;
    setError(undefined);
    setNotice(undefined);
    setOpeningEditor(editor);
    try {
      const response = await openEditor({ owner: selected.owner, repo: selected.repo, number: selected.number, editor });
      setNotice(`Opened PR checkout in ${editor === "vscode" ? "VS Code" : "IntelliJ"} using ${response.command}: ${response.repoDir}`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setOpeningEditor(undefined);
    }
  }

  async function pushCodexFix(id: string) {
    setError(undefined);
    setNotice(undefined);
    setFixJobs((current) => {
      const existing = current[id];
      if (!existing) return current;
      return {
        ...current,
        [id]: {
          ...existing,
          status: "running",
          phase: "committing",
          statusMessage: "Committing approved Codex fixes.",
          updatedAt: new Date().toISOString()
        }
      };
    });
    void pollFixJob(id);
    try {
      const job = await pushFix({ id });
      setFixJobs((current) => ({ ...current, [id]: job }));
      void pollFixJob(id);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function retryCodexFix(id: string, instructions?: string) {
    setError(undefined);
    setNotice(undefined);
    try {
      const job = await retryFix({ id, instructions });
      setFixJobs((current) => ({ ...current, [job.id]: job }));
      void pollFixJob(job.id);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function askCodexFix(id: string, question: string) {
    const text = question.trim();
    if (!text) return;
    setError(undefined);
    setNotice(undefined);
    setAskingFixId(id);
    try {
      const response = await askFix({ id, question: text });
      setFixJobs((current) => ({ ...current, [response.job.id]: response.job }));
      setNotice(response.job.status === "queued" || response.job.status === "running" ? "Guidance queued for the active Fix session." : "Codex answered in the existing Fix session.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setAskingFixId(undefined);
    }
  }

  async function cancelCodexFix(id: string) {
    setError(undefined);
    setNotice(undefined);
    try {
      const job = await cancelFix(id);
      setFixJobs((current) => ({ ...current, [job.id]: job }));
      setNotice("Fix job cancellation requested.");
      void pollFixJob(id);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function refreshFixDiff(id: string) {
    try {
      const live = await getFixLiveDiff(id);
      setFixJobs((current) => {
        const existing = current[id];
        if (!existing) return current;
        return {
          ...current,
          [id]: {
            ...existing,
            diff: live.diff,
            repoDir: live.repoDir ?? existing.repoDir,
            updatedAt: live.updatedAt
          }
        };
      });
      setNotice("Prepared code changes refreshed from git status.");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function rebaseSelectedToDefault() {
    if (!selected) return;
    setError(undefined);
    setNotice(undefined);
    setRebasing(true);
    try {
      const response = await rebasePrDefault({ owner: selected.owner, repo: selected.repo, number: selected.number });
      setRebasePreview(response);
      setNotice(response.message);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setRebasing(false);
    }
  }

  async function changeSelectedTargetBranch(baseRefName: string) {
    if (!selected) return;
    setError(undefined);
    setNotice(undefined);
    setTargetChanging(true);
    try {
      const response = await updatePrTargetBranch({ owner: selected.owner, repo: selected.repo, number: selected.number, baseRefName });
      setNotice(response.message);
      await loadDetail(selected, true);
      await refreshPrs();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setTargetChanging(false);
    }
  }

  async function approveRebasePreview() {
    if (!selected || !rebasePreview?.previewId) return;
    setError(undefined);
    setNotice(undefined);
    setRebasing(true);
    try {
      const response = await confirmRebaseDefault({ previewId: rebasePreview.previewId });
      if (!response.success) throw new Error([response.message, response.stderr, response.stdout].filter(Boolean).join("\n\n"));
      setRebasePreview(undefined);
      setNotice(response.message);
      await loadDetail(selected);
      await refreshPrs();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setRebasing(false);
    }
  }

  async function fetchCiLog(check: CiCheck) {
    if (!selected) return;
    setCiLoading((current) => ({ ...current, [check.link]: true }));
    setError(undefined);
    try {
      const response = await getCiLog({ owner: selected.owner, repo: selected.repo, number: selected.number, link: check.link });
      setCiLogs((current) => ({ ...current, [check.link]: response.log }));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setCiLoading((current) => ({ ...current, [check.link]: false }));
    }
  }

  async function clearSelectedCache() {
    if (!selected) return;
    await clearCache(selected.key);
    setAnalysis(undefined);
    await refreshPrs();
  }

  function addReviewComment(comment: ReviewComment) {
    if (!selectedKey) return;
    setReviewComments((current) => {
      const existing = current[selectedKey] ?? [];
      const sameLine = existing.find(
        (item) => item.path === comment.path && item.line === comment.line && item.side === comment.side
      );
      if (sameLine) return current;
      return {
        ...current,
        [selectedKey]: [...existing, { ...comment, id: crypto.randomUUID() }]
      };
    });
  }

  function updateReviewComment(id: string, body: string) {
    if (!selectedKey) return;
    setReviewComments((current) => ({
      ...current,
      [selectedKey]: (current[selectedKey] ?? []).map((comment) => (comment.id === id ? { ...comment, body } : comment))
    }));
  }

  function deleteReviewComment(id: string) {
    if (!selectedKey) return;
    setReviewComments((current) => ({
      ...current,
      [selectedKey]: (current[selectedKey] ?? []).filter((comment) => comment.id !== id)
    }));
  }

  function toggleExpandedFile(path: string) {
    if (!selectedKey) return;
    setExpandedFiles((current) => ({
      ...current,
      [selectedKey]: current[selectedKey] === path ? undefined : path
    }));
  }

  function togglePrRow(key: string) {
    setExpandedPrRows((current) => ({ ...current, [key]: !current[key] }));
  }

  async function submitSelectedReview(event: ReviewDecision) {
    if (!selected) return;
    const comments = selectedComments.filter((comment) => comment.body.trim().length > 0);
    if (comments.length === 0 && event === "REQUEST_CHANGES") {
      setError("Add at least one non-empty diff comment before requesting changes.");
      return;
    }
    if (comments.length === 0 && event === "APPROVE" && !canApproveWithoutComments) {
      setError("Complete the review wizard before approving without comments.");
      return;
    }
    setSubmittingReview(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await submitReview({
        owner: selected.owner,
        repo: selected.repo,
        number: selected.number,
        event,
        body: reviewBody,
        comments
      });
      setReviewDialogOpen(false);
      setReviewBody("");
      setReviewComments((current) => ({ ...current, [selected.key]: [] }));
      await saveProgress({ lastReviewedAt: response.submittedAt || new Date().toISOString() });
      setNotice(`Review submitted${response.state ? ` as ${response.state}` : ""}.`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSubmittingReview(false);
    }
  }

  function setConversationReplyDraft(commentId: number, body: string) {
    setConversationReplyDrafts((current) => ({ ...current, [commentId]: body }));
  }

  function toggleConversationReply(commentId: number) {
    setOpenConversationReplies((current) => ({ ...current, [commentId]: !current[commentId] }));
  }

  function cancelConversationReply(commentId: number) {
    setConversationReplyDraft(commentId, "");
    setOpenConversationReplies((current) => ({ ...current, [commentId]: false }));
  }

  async function submitConversationReply(commentId: number) {
    if (!selected || !selectedDetail) return;
    const body = (conversationReplyDrafts[commentId] ?? "").trim();
    if (!body) {
      setError("Write a reply before posting it.");
      return;
    }
    setPostingConversationReply((current) => ({ ...current, [commentId]: true }));
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await replyConversation({
        owner: selected.owner,
        repo: selected.repo,
        number: selected.number,
        inReplyTo: commentId,
        body
      });
      setDetail((current) => {
        if (!current || current.key !== selected.key) return current;
        return {
          ...current,
          conversationComments: [...current.conversationComments, response.comment],
          commentsCount: current.commentsCount + 1
        };
      });
      setPrs((current) =>
        current.map((pr) => (pr.key === selected.key ? { ...pr, commentsCount: pr.commentsCount + 1 } : pr))
      );
      setConversationReplyDrafts((current) => {
        const next = { ...current };
        delete next[commentId];
        return next;
      });
      setOpenConversationReplies((current) => ({ ...current, [commentId]: false }));
      setNotice(response.replyMode === "issue-comment" ? "PR conversation comment posted." : "Conversation reply posted.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPostingConversationReply((current) => ({ ...current, [commentId]: false }));
    }
  }

  async function saveProgress(patch: Partial<Pick<ReviewProgress, "checkedItems" | "reviewedFiles" | "ignoredRuleIds" | "manualChecks" | "project" | "issueProjects" | "notes" | "lastReviewedAt">>) {
    if (!selectedKey) return;
    const base = progress ?? { prKey: selectedKey, checkedItems: [], reviewedFiles: [], ignoredRuleIds: [], manualChecks: {}, project: "", issueProjects: {}, notes: "", updatedAt: new Date().toISOString() };
    const optimistic = { ...base, ...patch, updatedAt: new Date().toISOString() };
    setProgress(optimistic);
    try {
      setProgress(await updateProgress(selectedKey, patch));
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function attachSelectedToGithubProject(projectId: string, includeLinkedIssues: boolean) {
    if (!selectedDetail) return;
    setProjectAttachBusy(true);
    setError(undefined);
    try {
      const response = await attachGithubProject({
        owner: selectedDetail.owner,
        repo: selectedDetail.repo,
        number: selectedDetail.number,
        projectId,
        includeLinkedIssues
      });
      const project = githubProjects.find((item) => item.id === projectId);
      if (project?.title) {
        await saveProgress({
          project: project.title,
          issueProjects: linkedIssueProjectsForDetail(selectedDetail, progress, project.title)
        });
      }
      setNotice(`Attached ${response.attached.length} GitHub Project item${response.attached.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setProjectAttachBusy(false);
    }
  }

  async function exportLocalReviewData() {
    setError(undefined);
    try {
      const bundle = await downloadCacheBundle();
      setNotice(`Exported local review bundle: ${bundle.fileName}`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function clearAllReviewData() {
    if (!window.confirm("Clear all local MNLens review data, including cached PRs, analyses, progress, jobs, artifacts, and worktrees?")) return;
    setError(undefined);
    try {
      await clearAllLocalData();
      setPrs([]);
      setSelectedKey(undefined);
      setDetail(undefined);
      setAnalysis(undefined);
      setProgress(undefined);
      setJobs({});
      setVerificationJobs({});
      setFixJobs({});
      setCiChecks({});
      setRepoRules([]);
      setCacheText("Local review data cleared");
      setNotice("Cleared local review data.");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function addRepoRule(rule: { title: string; body: string; tone?: string; source?: string }) {
    if (!selected) return;
    try {
      const created = await createRepoRule(selected.owner, selected.repo, rule);
      setRepoRules((current) => [created, ...current]);
      setNotice(`Saved repo rule: ${created.title}`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function setRepoRuleEnabled(id: string, enabled: boolean) {
    if (!selected) return;
    try {
      const updated = await updateRepoRule(selected.owner, selected.repo, id, { enabled });
      setRepoRules((current) => current.map((rule) => (rule.id === id ? updated : rule)));
    } catch (err) {
      setError(messageOf(err));
    }
  }

  const selectedJob = Object.values(jobs)
    .filter((job) => job.prKey === selectedKey)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const activeAnalysis = analysis ?? selectedJob?.result;
  const activeDetailAnalysis = selectedDetail ? activeAnalysis : undefined;
  const canApproveWithoutComments = selectedDetail ? isReviewPlanComplete(selectedDetail, activeDetailAnalysis, progress) : false;
  const selectedReadiness =
    selected && selectedDetail
      ? readinessForPr(selected, {
          detail: selectedDetail,
          analysis: activeDetailAnalysis,
          progress,
          ciChecks: selectedCiChecks,
          verificationJobs: selectedVerificationJobs,
          job: selectedJob,
          fixJobs: selectedFixJobs,
          draftComments: selectedComments,
          canApproveWithoutComments
        })
      : selected
        ? readinessForPr(selected)
        : undefined;
  const selectedReviewScore =
    selected && selectedDetail
      ? reviewScoreForPr(selected, {
          detail: selectedDetail,
          analysis: activeDetailAnalysis,
          progress,
          ciChecks: selectedCiChecks,
          verificationJobs: selectedVerificationJobs,
          job: selectedJob,
          fixJobs: selectedFixJobs,
          draftComments: selectedComments,
          canApproveWithoutComments
        })
      : selected
        ? reviewScoreForPr(selected, { job: selectedJob })
        : undefined;

  useEffect(() => {
    if (!selectedKey || !selectedDetail || !selectedReviewScore) return;
    setFullReviewScores((current) => {
      const existing = current[selectedKey];
      if (existing && sameSidebarScore(existing, selectedReviewScore)) return current;
      return { ...current, [selectedKey]: selectedReviewScore };
    });
  }, [
    selectedKey,
    selectedDetail?.diffHash,
    selectedReviewScore?.score,
    selectedReviewScore?.label,
    selectedReviewScore?.tone,
    selectedReviewScore?.effort.label,
    selectedReviewScore?.effort.minutes
  ]);
  if (shouldShowSetup) {
    return (
      <SetupScreen
        status={setupStatus}
        auth={auth}
        loading={setupLoading}
        error={setupError}
        token={authTokenInput}
        savingToken={savingAuthToken}
        betaLimitations={betaLimitations}
        onRefresh={() => {
          void refreshSetupStatus();
          void refreshAuth();
        }}
        onRefreshAuth={() => void refreshAuth()}
        onTokenChange={setAuthTokenInput}
        onSaveToken={() => void saveGithubToken()}
        onContinue={continueSetup}
      />
    );
  }

  return (
    <main className={`app-shell ${selected ? "has-selection" : ""} ${mobileQueueOpen ? "mobile-queue-open" : ""}`}>
      <PrQueueSidebar
        auth={auth}
        authTokenInput={authTokenInput}
        savingAuthToken={savingAuthToken}
        busy={busy}
        cacheText={cacheText}
        collapsedRepos={collapsedRepos}
        expandedPrRows={expandedPrRows}
        fixJobs={fixJobs}
        includeMine={includeMine}
        mobileCloseVisible={Boolean(selected)}
        query={query}
        queue={queue}
        repoFilter={repoFilter}
        repos={repos}
        selectedKey={selectedKey}
        selectedReviewScore={selectedReviewScore}
        sortDirection={sortDirection}
        sortField={sortField}
        theme={theme}
        typeFilter={typeFilter}
        unanalyzedVisibleCount={unanalyzedVisibleCount}
        visibleAnalysisBatch={visibleAnalysisBatch}
        visiblePrGroups={visiblePrGroups}
        visiblePrs={visiblePrs}
        workActivity={workActivity}
        latestJobForPr={latestJobForPr}
        onAnalyzeVisible={() => void startAnalysis(visibleAnalysisBatch, false, "fast")}
        onCloseMobile={() => setMobileQueueOpen(false)}
        onIncludeMineChange={setIncludeMine}
        onQueryChange={setQuery}
        onQueueChange={setQueue}
        onRefreshAuth={() => void refreshAuth()}
        onRefreshPrs={() => void refreshPrs()}
        onRepoFilterChange={setRepoFilter}
        onSaveGithubToken={() => void saveGithubToken()}
        onCancelActivity={(item) => void cancelWorkActivity(item)}
        onCancelQueuedActivity={() => void cancelQueuedWorkActivity()}
        onClearAllData={() => void clearAllReviewData()}
        onExportData={() => void exportLocalReviewData()}
        onSelectActivity={(item) => {
          setSelectedKey(item.prKey);
          setTab(item.targetTab);
          setHighlightedFixJobId(item.kind === "Codex fix" ? item.jobId : undefined);
          setMobileQueueOpen(false);
        }}
        onSelectPr={(pr) => {
          if (pr.key === selectedKey) void loadDetail(pr);
          setSelectedKey(pr.key);
          setTab("overview");
          setMobileQueueOpen(false);
        }}
        onSortDirectionChange={setSortDirection}
        onSortFieldChange={setSortField}
        onThemeToggle={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        onTogglePrRow={togglePrRow}
        onToggleRepoGroup={toggleRepoGroup}
        onTokenChange={setAuthTokenInput}
        onTypeFilterChange={setTypeFilter}
        readinessForPr={readinessForPr}
        scoreForPrList={scoreForPrList}
      />

      <DetailPaneChrome
        activeWorkCount={workActivity.length}
        error={error}
        hasSelection={Boolean(selected)}
        notice={notice}
        onOpenQueue={() => setMobileQueueOpen(true)}
      >
        {selected ? (
          <>
            <PrDetailHeader
              analysis={activeDetailAnalysis}
              attentionMode={attentionMode}
              detail={selectedDetail}
              isOwnedByCurrentUser={selectedIsOwnedByCurrentUser}
              job={selectedJob}
              pr={selected}
              readiness={selectedReadiness}
              rebasing={rebasing}
              reviewScore={selectedReviewScore}
              selectedFixRunning={selectedFixRunning}
              targetBranches={selectedDetail ? (targetBranches[selectedDetail.repository] ?? []) : []}
              targetChanging={targetChanging}
              onAnalyze={() => void startAnalysis([selected], false, "deep")}
              onChangeTargetBranch={(baseRefName) => void changeSelectedTargetBranch(baseRefName)}
              onClearCache={() => void clearSelectedCache()}
              onImprovePr={() => void startOwnerImprovePr()}
              onReanalyze={() => void startAnalysis([selected], true, "deep")}
              onRebaseDefault={() => void rebaseSelectedToDefault()}
              onToggleAttention={() => setAttentionMode((value) => !value)}
            />

            {rebasePreview?.previewId && (
              <RebasePreviewPanel
                preview={rebasePreview}
                busy={rebasing}
                onApprove={() => void approveRebasePreview()}
                onDiscard={() => setRebasePreview(undefined)}
              />
            )}

            {selectedJob && (selectedJob.status === "running" || selectedJob.status === "queued") ? (
              <div className="running">
                <Loader2 size={18} className="spin" />
                Codex analysis is {selectedJob.status}.
              </div>
            ) : null}

            <ReviewTabs
              active={tab}
              refreshing={refreshingSelected}
              onChange={setTab}
              onRefresh={() => void refreshSelectedData()}
            />

            <DetailTab
              tab={tab}
              detail={selectedDetail}
              analysis={activeDetailAnalysis}
              progress={progress}
              githubProjects={githubProjects}
              githubProjectsError={githubProjectsError}
              projectAttachBusy={projectAttachBusy}
              repoRules={repoRules}
              reviewComments={selectedComments}
              analysisJobs={selectedAnalysisJobs}
              verificationJobs={selectedVerificationJobs}
              fixJobs={selectedFixJobs}
              highlightedFixJobId={highlightedFixJobId}
              ciChecks={selectedCiChecks}
              ciLogs={ciLogs}
              ciLoading={ciLoading}
              canApproveWithoutComments={canApproveWithoutComments}
              attentionMode={attentionMode}
              openingEditor={openingEditor}
              expandedFile={selectedKey ? expandedFiles[selectedKey] : undefined}
              wizardStep={wizardStep}
              onWizardStepChange={setWizardStep}
              onSaveProgress={(patch) => void saveProgress(patch)}
              onAttachGithubProject={(projectId, includeLinkedIssues) => void attachSelectedToGithubProject(projectId, includeLinkedIssues)}
              onAddRepoRule={(rule) => void addRepoRule(rule)}
              onSetRepoRuleEnabled={(id, enabled) => void setRepoRuleEnabled(id, enabled)}
              onToggleExpandedFile={toggleExpandedFile}
              onAddReviewComment={addReviewComment}
              onUpdateReviewComment={updateReviewComment}
              onDeleteReviewComment={deleteReviewComment}
              onOpenReviewDialog={() => setReviewDialogOpen(true)}
              onRunVerification={(command) => void startVerification(command)}
              onRunManualVerification={(item, id) => void startManualVerification(item, id)}
              onOpenEditor={(editor) => void openSelectedInEditor(editor)}
              onStartFix={(instructions, baseJobId, source) => {
                setTab("fix");
                void startCodexFix(instructions, baseJobId, source);
              }}
              askingFixId={askingFixId}
              onAskFix={(id, question) => void askCodexFix(id, question)}
              onPushFix={(id) => void pushCodexFix(id)}
              onRetryFix={(id, instructions) => void retryCodexFix(id, instructions)}
              onCancelFix={(id) => void cancelCodexFix(id)}
              onRefreshFixDiff={(id) => void refreshFixDiff(id)}
              onFetchCiLog={(check) => void fetchCiLog(check)}
              openConversationReplies={openConversationReplies}
              conversationReplyDrafts={conversationReplyDrafts}
              postingConversationReply={postingConversationReply}
              onToggleConversationReply={toggleConversationReply}
              onUpdateConversationReplyDraft={setConversationReplyDraft}
              onCancelConversationReply={cancelConversationReply}
              onSubmitConversationReply={(commentId) => void submitConversationReply(commentId)}
              buildRecommendation={finalReviewRecommendation}
              buildHandoffMarkdown={buildHandoffMarkdown}
            />
            {selected && reviewDialogOpen && (
              <ReviewDialog
                commentsCount={selectedComments.filter((comment) => comment.body.trim().length > 0).length}
                canApproveWithoutComments={canApproveWithoutComments}
                body={reviewBody}
                submitting={submittingReview}
                onBodyChange={setReviewBody}
                onClose={() => setReviewDialogOpen(false)}
                onSubmit={(event) => void submitSelectedReview(event)}
              />
            )}
          </>
        ) : null}
      </DetailPaneChrome>
    </main>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function linkedIssueProjectsForDetail(detail: PrDetail, progress: ReviewProgress | undefined, project: string): Record<string, string> {
  const issueProjects = { ...(progress?.issueProjects ?? {}) };
  for (const issue of detail.linkedIssues ?? []) {
    issueProjects[`${issue.repository ?? detail.repository}#${issue.number}`] = project;
  }
  return issueProjects;
}
