import type {
  AnalysisResult,
  AskFixRequest,
  AskFixResponse,
  AnalyzeResponse,
  AttachGithubProjectRequest,
  AttachGithubProjectResponse,
  AskCiRequest,
  AskCiResponse,
  AskResearchRequest,
  AskResearchResponse,
  AskRiskRequest,
  AskRiskResponse,
  AuthStatus,
  CacheExportResponse,
  CacheStats,
  CiCheck,
  CiLogRequest,
  CiLogResponse,
  FixJob,
  FixLiveDiffResponse,
  FixRequest,
  GithubProject,
  ManualVerificationRequest,
  PushFixRequest,
  LocalSessionStatus,
  OpenEditorRequest,
  OpenEditorResponse,
  Job,
  PrDetail,
  PrListItem,
  PrRef,
  RepositoryBranch,
  QueueName,
  CreateRepoReviewRuleRequest,
  RebasePrConfirmRequest,
  RebasePrRequest,
  RebasePrResponse,
  ReplyConversationRequest,
  ReplyConversationResponse,
  RepoReviewRule,
  ReviewProgress,
  RetryFixRequest,
  SetupStatus,
  StoreGithubTokenRequest,
  SubmitReviewRequest,
  SubmitReviewResponse,
  UpdatePrTargetBranchRequest,
  UpdatePrTargetBranchResponse,
  UpdateRepoReviewRuleRequest,
  UpdateReviewProgressRequest,
  VerificationJob,
  VerificationRequest
} from "../../shared/types";

let localSessionPromise: Promise<LocalSessionStatus> | undefined;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const session = url === "/api/session" ? undefined : await getLocalSession();
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { "x-mnlens-session": session.token } : {}),
      ...options?.headers
    }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string; stdout?: string; stderr?: string; rateLimit?: { until?: string } };
    const parts = [body.error ?? body.message ?? `${response.status} ${response.statusText}`, body.stderr, body.stdout].filter(Boolean);
    if (response.status === 429 && body.rateLimit?.until) {
      parts.push(`Retry after ${new Date(body.rateLimit.until).toLocaleTimeString()}.`);
    }
    throw new Error(parts.join("\n\n"));
  }
  return response.json() as Promise<T>;
}

export function getLocalSession(): Promise<LocalSessionStatus> {
  localSessionPromise ??= request<LocalSessionStatus>("/api/session");
  return localSessionPromise;
}

export function getAuthStatus(): Promise<AuthStatus> {
  return request<AuthStatus>("/api/auth/status");
}

export function getGithubProjects(owner: string): Promise<GithubProject[]> {
  return request<GithubProject[]>(`/api/github-projects/${encodeURIComponent(owner)}`);
}

export function attachGithubProject(payload: AttachGithubProjectRequest): Promise<AttachGithubProjectResponse> {
  return request<AttachGithubProjectResponse>("/api/github-projects/attach", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getSetupStatus(): Promise<SetupStatus> {
  return request<SetupStatus>("/api/setup/status");
}

export function storeGithubToken(token: string): Promise<AuthStatus> {
  const payload: StoreGithubTokenRequest = { token };
  return request<AuthStatus>("/api/auth/token", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getPrs(queue: QueueName, includeMine = false): Promise<PrListItem[]> {
  return request<PrListItem[]>(`/api/prs?queue=${queue}&includeMine=${includeMine ? "true" : "false"}`);
}

export function getPrDetail(pr: PrRef): Promise<PrDetail> {
  return request<PrDetail>(`/api/prs/${pr.owner}/${pr.repo}/${pr.number}`);
}

export function getRepositoryBranches(owner: string, repo: string): Promise<RepositoryBranch[]> {
  return request<RepositoryBranch[]>(`/api/repos/${owner}/${repo}/branches`);
}

export function updatePrTargetBranch(payload: UpdatePrTargetBranchRequest): Promise<UpdatePrTargetBranchResponse> {
  return request<UpdatePrTargetBranchResponse>(`/api/prs/${payload.owner}/${payload.repo}/${payload.number}/target-branch`, {
    method: "POST",
    body: JSON.stringify({ baseRefName: payload.baseRefName })
  });
}

export function getAnalysis(key: string): Promise<AnalysisResult | null> {
  return request<AnalysisResult | null>(`/api/analysis/${key}`);
}

export function analyzePrs(prs: PrRef[], force = false, mode: "fast" | "deep" = "deep"): Promise<AnalyzeResponse> {
  return request<AnalyzeResponse>("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ prs, force, mode })
  });
}

export function getJob(id: string): Promise<Job> {
  return request<Job>(`/api/jobs/${id}`);
}

export function cancelAnalysis(id: string): Promise<Job> {
  return request<Job>(`/api/jobs/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ id })
  });
}

export function askRisk(payload: AskRiskRequest): Promise<AskRiskResponse> {
  return request<AskRiskResponse>("/api/ask-risk", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function askCiFailure(payload: AskCiRequest): Promise<AskCiResponse> {
  return request<AskCiResponse>("/api/ask-ci", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function askResearch(payload: AskResearchRequest): Promise<AskResearchResponse> {
  return request<AskResearchResponse>("/api/ask-research", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getCiChecks(pr: PrRef): Promise<CiCheck[]> {
  return request<CiCheck[]>(`/api/ci/${pr.owner}/${pr.repo}/${pr.number}`);
}

export function getCiLog(payload: CiLogRequest): Promise<CiLogResponse> {
  return request<CiLogResponse>("/api/ci/logs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function rebasePrDefault(payload: RebasePrRequest): Promise<RebasePrResponse> {
  return request<RebasePrResponse>("/api/rebase-default", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updatePrBranch(payload: RebasePrRequest): Promise<RebasePrResponse> {
  return request<RebasePrResponse>("/api/update-branch", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function mergePrTarget(payload: RebasePrRequest): Promise<RebasePrResponse> {
  return request<RebasePrResponse>("/api/merge-target", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function confirmRebaseDefault(payload: RebasePrConfirmRequest): Promise<RebasePrResponse> {
  return request<RebasePrResponse>("/api/rebase-default/confirm", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function runVerification(payload: VerificationRequest): Promise<VerificationJob> {
  return request<VerificationJob>("/api/verification", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function runManualVerification(payload: ManualVerificationRequest): Promise<VerificationJob> {
  return request<VerificationJob>("/api/verification/manual", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getVerificationJob(id: string): Promise<VerificationJob> {
  return request<VerificationJob>(`/api/verification/${id}`);
}

export function getVerificationJobs(prKey: string): Promise<VerificationJob[]> {
  return request<VerificationJob[]>(`/api/verification?prKey=${encodeURIComponent(prKey)}`);
}

export function cancelVerification(id: string): Promise<VerificationJob> {
  return request<VerificationJob>(`/api/verification/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ id })
  });
}

export function startFix(payload: FixRequest): Promise<FixJob> {
  return request<FixJob>("/api/fixes", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getFixJob(id: string): Promise<FixJob> {
  return request<FixJob>(`/api/fixes/${id}`);
}

export function getFixLiveDiff(id: string): Promise<FixLiveDiffResponse> {
  return request<FixLiveDiffResponse>(`/api/fixes/${id}/diff`);
}

export function getFixJobs(prKey: string): Promise<FixJob[]> {
  return request<FixJob[]>(`/api/fixes?prKey=${encodeURIComponent(prKey)}`);
}

export function getActiveFixJobs(): Promise<FixJob[]> {
  return request<FixJob[]>("/api/fixes?active=true");
}

export function pushFix(payload: PushFixRequest): Promise<FixJob> {
  return request<FixJob>(`/api/fixes/${payload.id}/push`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function retryFix(payload: RetryFixRequest): Promise<FixJob> {
  return request<FixJob>(`/api/fixes/${payload.id}/retry`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function askFix(payload: AskFixRequest): Promise<AskFixResponse> {
  return request<AskFixResponse>(`/api/fixes/${payload.id}/ask`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function cancelFix(id: string): Promise<FixJob> {
  return request<FixJob>(`/api/fixes/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ id })
  });
}

export function openEditor(payload: OpenEditorRequest): Promise<OpenEditorResponse> {
  return request<OpenEditorResponse>("/api/open-editor", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function submitReview(payload: SubmitReviewRequest): Promise<SubmitReviewResponse> {
  return request<SubmitReviewResponse>("/api/reviews", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function replyConversation(payload: ReplyConversationRequest): Promise<ReplyConversationResponse> {
  return request<ReplyConversationResponse>("/api/conversation-replies", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getProgress(key: string): Promise<ReviewProgress> {
  return request<ReviewProgress>(`/api/progress/${key}`);
}

export function updateProgress(key: string, payload: UpdateReviewProgressRequest): Promise<ReviewProgress> {
  return request<ReviewProgress>(`/api/progress/${key}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getRepoRules(owner: string, repo: string): Promise<RepoReviewRule[]> {
  return request<RepoReviewRule[]>(`/api/repo-rules/${owner}/${repo}`);
}

export function createRepoRule(owner: string, repo: string, payload: CreateRepoReviewRuleRequest): Promise<RepoReviewRule> {
  return request<RepoReviewRule>(`/api/repo-rules/${owner}/${repo}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateRepoRule(owner: string, repo: string, id: string, payload: UpdateRepoReviewRuleRequest): Promise<RepoReviewRule> {
  return request<RepoReviewRule>(`/api/repo-rules/${owner}/${repo}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getCacheStats(): Promise<CacheStats> {
  return request<CacheStats>("/api/cache");
}

export function exportCacheBundle(): Promise<CacheExportResponse> {
  return request<CacheExportResponse>("/api/cache/export", { method: "POST" });
}

export async function downloadCacheBundle(): Promise<CacheExportResponse> {
  const bundle = await exportCacheBundle();
  const session = await getLocalSession();
  const response = await fetch(bundle.url, { headers: { "x-mnlens-session": session.token } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = bundle.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
  return bundle;
}

export function clearAllLocalData(): Promise<{ clearedAt: string; cacheDir: string }> {
  return request<{ clearedAt: string; cacheDir: string }>("/api/cache", { method: "DELETE" });
}

export async function clearCache(key: string): Promise<void> {
  const session = await getLocalSession();
  const response = await fetch(`/api/cache/${key}`, { method: "DELETE", headers: { "x-mnlens-session": session.token } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
}

export function isAnalysisResult(value: unknown): value is AnalysisResult {
  return Boolean(value && typeof value === "object" && "draftComment" in value);
}
