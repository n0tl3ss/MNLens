import type {
  AuthStatus,
  AnalysisType,
  AttachGithubProjectResponse,
  CiCheck,
  GithubProject,
  PrDetail,
  ExistingComment,
  ExistingReviewComment,
  ExistingReviewSummary,
  LinkedIssue,
  PrCommit,
  PrCommitFile,
  PrQueue,
  PrFile,
  PrListItem,
  PrReviewerStatus,
  RepositoryBranch,
  QueueName,
  RebasePrResponse,
  ReplyConversationRequest,
  ReplyConversationResponse,
  SubmitReviewRequest,
  SubmitReviewResponse,
  UpdatePrTargetBranchResponse
} from "../shared/types.js";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { hashText, prKey, readAnalysis, readPrDetail, writePrDetail } from "./cache.js";
import { CommandError, type CommandResult, runCommand } from "./command.js";
import { codexHome, ensureCodexHome, normalizeAnalysisForDetail } from "./codex.js";
import { missingGithubTokenMessage, readGithubToken, tokenStoreInfo } from "./keychain.js";
import { cacheDir } from "./paths.js";
import {
  GithubRateLimitError,
  assertGithubRateLimitAvailable,
  githubRateLimitStatus,
  noteGithubRateLimit,
  noteGithubRateLimitBody,
  noteGithubRateLimitHeaders
} from "./githubRateLimit.js";

const searchFields = [
  "assignees",
  "author",
  "commentsCount",
  "createdAt",
  "id",
  "isDraft",
  "labels",
  "number",
  "repository",
  "state",
  "title",
  "updatedAt",
  "url"
].join(",");

const viewFields = [
  "additions",
  "assignees",
  "author",
  "baseRefName",
  "body",
  "changedFiles",
  "closingIssuesReferences",
  "comments",
  "comments",
  "commits",
  "createdAt",
  "deletions",
  "files",
  "headRefName",
  "headRefOid",
  "id",
  "isDraft",
  "labels",
  "latestReviews",
  "mergeStateStatus",
  "number",
  "reviewDecision",
  "reviewRequests",
  "state",
  "title",
  "updatedAt",
  "url"
].join(",");

const fastViewFields = [
  "additions",
  "baseRefName",
  "changedFiles",
  "comments",
  "deletions",
  "files",
  "headRefName",
  "headRefOid",
  "isDraft",
  "labels",
  "mergeStateStatus",
  "reviewDecision",
  "title",
  "updatedAt"
].join(",");

interface RebasePreviewState {
  id: string;
  strategy: "rebase" | "merge";
  owner: string;
  repo: string;
  number: number;
  repoName: string;
  repoDir: string;
  defaultBranch: string;
  headRefName: string;
  headRepository: string;
  conflictsResolved: number;
  createdAt: string;
}

const rebasePreviews = new Map<string, RebasePreviewState>();
let rateLimitCache: { fetchedAt: number; status: ReturnType<typeof githubRateLimitStatus> } | undefined;

export async function authStatus(): Promise<AuthStatus> {
  const store = tokenStoreInfo();
  const token = await readGithubToken();
  const base = {
    ...store,
    scopeHint: githubTokenScopeHint()
  };
  if (!token) {
    return {
      hasKeychainToken: false,
      ghAvailable: await commandExists("gh"),
      ghAuthenticated: false,
      ...base,
      scopeCheck: "unknown",
      error: missingGithubTokenMessage()
    };
  }

  try {
    const currentRateLimit = githubRateLimitStatus();
    if (currentRateLimit.limited) {
      return {
        hasKeychainToken: true,
        ghAvailable: await commandExists("gh"),
        ghAuthenticated: true,
        ...base,
        scopeCheck: "unknown",
        tokenScopes: [],
        missingScopes: [],
        githubRateLimit: currentRateLimit,
        error: currentRateLimit.message
      };
    }
    const [result, scopeInfo] = await Promise.all([
      runGh(["api", "user", "--jq", ".login"], token),
      inspectTokenScopes(token)
    ]);
    const githubRateLimit = await fetchGithubRateLimit(token).catch(() => githubRateLimitStatus());
    return {
      hasKeychainToken: true,
      ghAvailable: true,
      ghAuthenticated: true,
      ...base,
      ...scopeInfo,
      githubRateLimit,
      username: result.stdout.trim()
    };
  } catch (error) {
    if (error instanceof GithubRateLimitError) {
      return {
        hasKeychainToken: true,
        ghAvailable: await commandExists("gh"),
        ghAuthenticated: true,
        ...base,
        scopeCheck: "unknown",
        tokenScopes: [],
        missingScopes: [],
        githubRateLimit: githubRateLimitStatus(),
        error: error.message
      };
    }
    return {
      hasKeychainToken: true,
      ghAvailable: await commandExists("gh"),
      ghAuthenticated: false,
      ...base,
      scopeCheck: "unknown",
      error: commandErrorText(error)
    };
  }
}

const fullClassicTokenScopes = ["repo"];
const limitedClassicTokenScopes = ["public_repo"];

async function inspectTokenScopes(token: string): Promise<Pick<AuthStatus, "scopeCheck" | "tokenScopes" | "missingScopes">> {
  try {
    const result = await runGh(["api", "-i", "user"], token);
    const headerText = `${result.stdout}\n${result.stderr}`;
    noteGithubRateLimitHeaders(headerText);
    const scopes = parseOauthScopes(headerText);
    return classifyTokenScopes(scopes);
  } catch {
    return { scopeCheck: "unknown", tokenScopes: [], missingScopes: [] };
  }
}

export function parseOauthScopes(headers: string): string[] {
  const match = /^x-oauth-scopes:\s*(.+)$/im.exec(headers);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)
    .sort();
}

export function classifyTokenScopes(scopes: string[]): Pick<AuthStatus, "scopeCheck" | "tokenScopes" | "missingScopes"> {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) {
    return { scopeCheck: "unknown", tokenScopes: [], missingScopes: [] };
  }
  const hasFullRepo = normalized.includes("repo");
  const hasPublicRepo = normalized.includes("public_repo");
  const missingScopes = hasFullRepo || hasPublicRepo ? [] : fullClassicTokenScopes;
  return {
    scopeCheck: hasFullRepo ? "ok" : hasPublicRepo ? "limited" : "missing",
    tokenScopes: normalized,
    missingScopes
  };
}

function githubTokenScopeHint(): string {
  return [
    "Recommended least-privilege option: use a fine-grained PAT limited to the repositories you review.",
    "Fine-grained read/review mode: Metadata read, Contents read, Pull requests read, Issues read, Actions read, Checks read, Commit statuses read, and Projects read if you want GitHub Projects dropdowns.",
    "Fine-grained write actions: add Pull requests write for submitting reviews, Issues write for PR conversation comments, Contents write only if you will push approved fixes/rebases, and Projects write if you want MNLens to attach PRs/issues to GitHub Projects.",
    "Classic token Projects support: add `read:project` to list organization Projects and `project` to attach PRs/issues to Projects.",
    "Classic PAT fallback: `public_repo` is enough for public repository workflows; `repo` is only needed for private repositories or broad classic-token access."
  ].join("\n");
}

export async function listPrs(queue: QueueName, includeMine = false): Promise<PrListItem[]> {
  const token = await requireToken();
  const username = await getAuthenticatedUsername(token);
  const queues: PrQueue[] = queue === "all" ? ["assigned", "review-requested", "reviewed"] : [queue];
  if (includeMine && queue === "all") queues.push("authored");
  const batches = await Promise.all(queues.map((name) => searchQueue(name, token)));
  const byKey = new Map<string, PrListItem>();
  for (const batch of batches) {
    for (const item of batch) {
      if (!includeMine && item.author.toLowerCase() === username.toLowerCase()) continue;
      const existing = byKey.get(item.key);
      if (existing) {
        existing.queues = [...new Set([...existing.queues, ...item.queues])];
      } else {
        byKey.set(item.key, item);
      }
    }
  }

  const items = [...byKey.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const enriched = await Promise.all(
    items.map(async (item) => {
      const [analysis, cachedDetail] = await Promise.all([readAnalysis(item.key), readPrDetail(item.key)]);
      const withCachedDetail = cachedDetail
        ? {
            ...item,
            changedFiles: cachedDetail.changedFiles,
            reviewDecision: cachedDetail.reviewDecision,
            mergeStateStatus: cachedDetail.mergeStateStatus,
            branchBehindBy: cachedDetail.branchBehindBy,
            branchAheadBy: cachedDetail.branchAheadBy
          }
        : item;
      const normalizedAnalysis = analysis && cachedDetail ? normalizeAnalysisForDetail(cachedDetail, analysis) : analysis;
      return normalizedAnalysis
        ? {
            ...withCachedDetail,
            aiType: normalizedAnalysis.type,
            analysisStatus: "done" as const,
            analysisUpdatedAt: normalizedAnalysis.generatedAt,
            aiRiskCount: normalizedAnalysis.risks.length,
            aiTestsCount: normalizedAnalysis.testsToCheck.length
          }
        : withCachedDetail;
    })
  );
  return enriched;
}

export async function submitReview(request: SubmitReviewRequest): Promise<SubmitReviewResponse> {
  const token = await requireToken();
  const comments = (request.comments ?? [])
    .map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      body: comment.body.trim()
    }))
    .filter((comment) => comment.body.length > 0);

  if (comments.length === 0 && request.event === "REQUEST_CHANGES") {
    throw new Error("Add at least one non-empty line comment before requesting changes.");
  }

  const payload = {
    event: request.event,
    body: request.body?.trim() || undefined,
    ...(comments.length > 0 ? { comments } : {})
  };
  const result = await runGh(
    ["api", "-X", "POST", `repos/${request.owner}/${request.repo}/pulls/${request.number}/reviews`, "--input", "-"],
    token,
    JSON.stringify(payload)
  );
  const raw = JSON.parse(result.stdout) as { html_url?: string; state?: string; submitted_at?: string };
  return {
    url: raw.html_url,
    state: raw.state,
    submittedAt: raw.submitted_at ?? new Date().toISOString()
  };
}

export async function getFastPrAnalysis(owner: string, repo: string, number: number): Promise<Pick<PrListItem, "aiType" | "aiRiskCount" | "aiTestsCount" | "analysisStatus" | "analysisMode" | "analysisUpdatedAt" | "changedFiles" | "reviewDecision" | "mergeStateStatus" | "branchBehindBy" | "branchAheadBy" | "fastScore" | "fastScoreLabel" | "fastScoreTone" | "fastScoreConfidence">> {
  const token = await requireToken();
  const result = await runGh(["pr", "view", String(number), "--repo", `${owner}/${repo}`, "--json", fastViewFields], token);
  const raw = JSON.parse(result.stdout) as GhPrView;
  const branchComparison = await comparePrBranch(token, owner, repo, raw.baseRefName, raw.headRefName, raw.headRefOid).catch((): PrBranchComparison => ({}));
  const files = normalizeFiles(raw.files);
  const additions = raw.additions ?? 0;
  const deletions = raw.deletions ?? 0;
  const changedFiles = raw.changedFiles ?? files.length;
  const labels = normalizeLabels(raw.labels);
  const type = fastType(raw.title ?? "", labels, files);
  const riskCount = fastRiskCount({
    additions,
    changedFiles,
    deletions,
    files,
    isDraft: Boolean(raw.isDraft),
    mergeStateStatus: raw.mergeStateStatus,
    reviewDecision: raw.reviewDecision,
    type
  });
  const testsCount = fastTestsCount(type, files, additions + deletions, riskCount);
  const fastScore = fastScoreFor({
    additions,
    changedFiles,
    deletions,
    isDraft: Boolean(raw.isDraft),
    mergeStateStatus: raw.mergeStateStatus,
    reviewDecision: raw.reviewDecision,
    riskCount,
    testsCount,
    type
  });
  return {
    aiType: type,
    aiRiskCount: riskCount,
    aiTestsCount: testsCount,
    analysisStatus: "done",
    analysisMode: "fast",
    analysisUpdatedAt: new Date().toISOString(),
    changedFiles,
    reviewDecision: raw.reviewDecision,
    mergeStateStatus: raw.mergeStateStatus,
    branchBehindBy: branchComparison.behindBy,
    branchAheadBy: branchComparison.aheadBy,
    fastScore: fastScore.score,
    fastScoreLabel: fastScore.label,
    fastScoreTone: fastScore.tone,
    fastScoreConfidence: files.length > 0 ? "medium" : "low"
  };
}

export async function replyToConversation(request: ReplyConversationRequest): Promise<ReplyConversationResponse> {
  const token = await requireToken();
  const body = request.body.trim();
  if (!body) throw new Error("Reply body is required.");
  const result = await runGh(
    ["api", "-X", "POST", `repos/${request.owner}/${request.repo}/issues/${request.number}/comments`, "--input", "-"],
    token,
    JSON.stringify({ body })
  );
  const raw = JSON.parse(result.stdout) as GhIssueComment;
  return {
    replyMode: "issue-comment",
    comment: {
      id: raw.id,
      author: raw.user?.login ?? "unknown",
      authorUrl: raw.user?.html_url,
      url: raw.html_url ?? "",
      body: raw.body ?? body,
      createdAt: raw.created_at ?? new Date().toISOString()
    }
  };
}

export async function listRepositoryBranches(owner: string, repo: string): Promise<RepositoryBranch[]> {
  const token = await requireToken();
  const result = await runGh(["api", "-X", "GET", `repos/${owner}/${repo}/branches`, "-F", "per_page=100", "--hostname", "github.com"], token);
  const raw = JSON.parse(result.stdout) as Array<{ name?: string; protected?: boolean; commit?: { url?: string } }>;
  return raw
    .map((branch) => ({
      name: branch.name ?? "",
      url: branch.commit?.url,
      protected: branch.protected
    }))
    .filter((branch) => branch.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

type PrBranchComparison = { behindBy?: number; aheadBy?: number };

async function comparePrBranch(token: string, owner: string, repo: string, baseRefName?: string, headRefName?: string, headRefOid?: string): Promise<PrBranchComparison> {
  const base = baseRefName?.trim();
  const head = (headRefOid || headRefName)?.trim();
  if (!base || !head) return {};
  const result = await runGh(["api", "-X", "GET", `repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, "--hostname", "github.com"], token);
  const raw = JSON.parse(result.stdout) as { behind_by?: number; ahead_by?: number };
  return {
    behindBy: raw.behind_by,
    aheadBy: raw.ahead_by
  };
}

export async function updatePrTargetBranch(owner: string, repo: string, number: number, baseRefName: string): Promise<UpdatePrTargetBranchResponse> {
  const token = await requireToken();
  const base = baseRefName.trim();
  if (!base) throw new Error("Target branch is required.");
  await runGh(["api", "-X", "PATCH", `repos/${owner}/${repo}/pulls/${number}`, "-f", `base=${base}`, "--hostname", "github.com"], token);
  await getPrDetail(owner, repo, number);
  return {
    owner,
    repo,
    number,
    baseRefName: base,
    message: `PR #${number} now targets ${base}. Refreshing PR data.`
  };
}

export async function getCiChecks(owner: string, repo: string, number: number): Promise<CiCheck[]> {
  const token = await requireToken();
  const repoName = `${owner}/${repo}`;
  const result = await runGh(
    [
      "pr",
      "checks",
      String(number),
      "-R",
      repoName,
      "--json",
      "name,state,link,startedAt,completedAt,workflow,bucket,description"
    ],
    token
  );
  const raw = JSON.parse(result.stdout) as GhCiCheck[];
  const checkRuns = shouldEnrichCheckRuns(raw)
    ? await fetchCheckRunDetails(token, owner, repo, number).catch(() => new Map<string, EnrichedCheckRun>())
    : new Map<string, EnrichedCheckRun>();
  return raw.map((check) => ({
    name: check.name ?? "",
    workflow: check.workflow ?? "",
    state: check.state ?? "",
    bucket: check.bucket ?? "",
    description: checkRunDescription(check, checkRuns.get(check.name ?? "")),
    details: checkRunDetails(checkRuns.get(check.name ?? "")),
    link: checkRunLink(owner, repo, number, check, checkRuns.get(check.name ?? "")),
    startedAt: check.startedAt ?? "",
    completedAt: check.completedAt ?? "",
    canFetchLog: parseActionsJobLink(check.link ?? "") !== undefined || Boolean(checkRuns.get(check.name ?? "")?.id)
  }));
}

export async function getCiLog(owner: string, repo: string, link: string): Promise<string> {
  const token = await requireToken();
  const ids = parseActionsJobLink(link);
  const checkRunId = parseCheckRunLink(link);
  if (checkRunId && !ids) {
    return fetchCheckRunOutput(token, owner, repo, checkRunId);
  }
  if (!ids) throw new Error("Logs can only be fetched for GitHub Actions job links or GitHub check-run details.");
  try {
    const result = await runGh(["run", "view", ids.runId, "-R", `${owner}/${repo}`, "--job", ids.jobId, "--log"], token);
    return result.stdout;
  } catch (error) {
    if (error instanceof CommandError && isActionsLogPending(error)) {
      return [
        "GitHub Actions logs are not available yet.",
        "",
        commandOutput(error) || "The workflow run is still in progress. Wait for the job to complete, then click Fetch details again."
      ].join("\n");
    }
    throw error;
  }
}

export async function getPrDetail(owner: string, repo: string, number: number): Promise<PrDetail> {
  const token = await requireToken();
  const repoName = `${owner}/${repo}`;
  const [view, diff] = await Promise.all([
    runGh(["pr", "view", String(number), "-R", repoName, "--json", viewFields], token),
    fetchPullRequestDiff(token, owner, repo, number)
  ]);

  const raw = JSON.parse(view.stdout) as GhPrView;
  const branchComparison = await comparePrBranch(token, owner, repo, raw.baseRefName, raw.headRefName, raw.headRefOid).catch((): PrBranchComparison => ({}));
  const linkedIssues = await enrichLinkedIssues(token, normalizeLinkedIssues(raw.closingIssuesReferences, repoName));
  const [conversationComments, reviewSummaries, reviewComments, commits] = await Promise.all([
    fetchConversationComments(token, owner, repo, number),
    fetchReviewSummaries(token, owner, repo, number),
    fetchReviewComments(token, owner, repo, number),
    fetchPrCommits(token, owner, repo, number)
  ]);
  const key = prKey(owner, repo, number);
  const labels = normalizeLabels(raw.labels);
  const detail: PrDetail = {
    key,
    owner,
    repo,
    number: raw.number ?? number,
    title: raw.title ?? "",
    url: raw.url ?? `https://github.com/${repoName}/pull/${number}`,
    repository: repoName,
    author: raw.author?.login ?? "unknown",
    authorUrl: raw.author?.url ?? (raw.author?.login ? `https://github.com/${raw.author.login}` : undefined),
    labels,
    queues: queueMembership(raw),
    state: raw.state ?? "UNKNOWN",
    isDraft: Boolean(raw.isDraft),
    createdAt: raw.createdAt ?? "",
    updatedAt: raw.updatedAt ?? "",
    commentsCount: Array.isArray(raw.comments) ? raw.comments.length : 0,
    body: raw.body ?? "",
    nodeId: raw.id,
    linkedIssues,
    baseRefName: raw.baseRefName ?? "",
    headRefName: raw.headRefName ?? "",
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFiles ?? 0,
    reviewDecision: raw.reviewDecision,
    mergeStateStatus: raw.mergeStateStatus,
    branchBehindBy: branchComparison.behindBy,
    branchAheadBy: branchComparison.aheadBy,
    reviewers: normalizeReviewerStatuses(raw),
    files: normalizeFiles(raw.files),
    commits,
    conversationComments,
    reviewSummaries,
    reviewComments,
    diff: diff.stdout,
    diffHash: hashText(diff.stdout)
  };
  await writePrDetail(detail);
  return detail;
}

export async function listGithubProjects(owner: string): Promise<GithubProject[]> {
  const token = await requireToken();
  const organizationProjects = await listOrganizationProjects(token, owner);
  if (organizationProjects.length > 0) return organizationProjects;
  return listUserProjects(token, owner);
}

async function listOrganizationProjects(token: string, owner: string): Promise<GithubProject[]> {
  const query = `
    query($login: String!) {
      organization(login: $login) {
        projectsV2(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { id title url number }
        }
      }
    }
  `;
  try {
    const result = await runGh(["api", "graphql", "-f", `query=${query}`, "-F", `login=${owner}`], token);
    const raw = JSON.parse(result.stdout) as { data?: { organization?: { projectsV2?: { nodes?: GhProjectV2[] } } } };
    return normalizeGithubProjects(raw.data?.organization?.projectsV2?.nodes ?? [], owner, "organization");
  } catch {
    return [];
  }
}

async function listUserProjects(token: string, owner: string): Promise<GithubProject[]> {
  const query = `
    query($login: String!) {
      user(login: $login) {
        projectsV2(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { id title url number }
        }
      }
    }
  `;
  const result = await runGh(["api", "graphql", "-f", `query=${query}`, "-F", `login=${owner}`], token);
  const raw = JSON.parse(result.stdout) as { data?: { user?: { projectsV2?: { nodes?: GhProjectV2[] } } } };
  return normalizeGithubProjects(raw.data?.user?.projectsV2?.nodes ?? [], owner, "user");
}

function normalizeGithubProjects(nodes: GhProjectV2[], owner: string, ownerType: "organization" | "user"): GithubProject[] {
  return nodes.filter((project): project is Required<Pick<GhProjectV2, "id" | "title">> & GhProjectV2 => Boolean(project.id && project.title)).map((project) => ({
    id: project.id,
    title: project.title,
    url: project.url,
    number: project.number,
    owner,
    ownerType
  }));
}

export async function attachPrToGithubProject(owner: string, repo: string, number: number, projectId: string, includeLinkedIssues = true): Promise<AttachGithubProjectResponse> {
  const token = await requireToken();
  const detail = await getPrDetail(owner, repo, number);
  const attached: AttachGithubProjectResponse["attached"] = [];
  if (!detail.nodeId) throw new Error("GitHub did not return a node id for this pull request.");
  const prItemId = await addProjectItem(token, projectId, detail.nodeId);
  attached.push({ type: "pull-request", repository: detail.repository, number: detail.number, itemId: prItemId });
  if (includeLinkedIssues) {
    for (const issue of detail.linkedIssues) {
      if (!issue.nodeId) continue;
      const itemId = await addProjectItem(token, projectId, issue.nodeId);
      attached.push({ type: "issue", repository: issue.repository ?? detail.repository, number: issue.number, itemId });
    }
  }
  return { projectId, attached };
}

async function addProjectItem(token: string, projectId: string, contentId: string): Promise<string | undefined> {
  const mutation = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item { id }
      }
    }
  `;
  const result = await runGh(["api", "graphql", "-f", `query=${mutation}`, "-F", `projectId=${projectId}`, "-F", `contentId=${contentId}`], token);
  const raw = JSON.parse(result.stdout) as { data?: { addProjectV2ItemById?: { item?: { id?: string } } } };
  return raw.data?.addProjectV2ItemById?.item?.id;
}

async function fetchPullRequestDiff(token: string, owner: string, repo: string, number: number): Promise<CommandResult> {
  try {
    return await runGh(["api", `repos/${owner}/${repo}/pulls/${number}`, "-H", "Accept: application/vnd.github.v3.diff", "--hostname", "github.com"], token);
  } catch {
    return runGh(["pr", "diff", String(number), "-R", `${owner}/${repo}`, "--color", "never"], token);
  }
}

export async function rebasePrOntoDefault(owner: string, repo: string, number: number): Promise<RebasePrResponse> {
  const token = await requireToken();
  const repoName = `${owner}/${repo}`;
  const defaultBranch = (await runGh(["repo", "view", repoName, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], token)).stdout.trim();
  if (!defaultBranch) throw new Error(`Could not determine default branch for ${repoName}.`);
  const prHead = JSON.parse(
    (await runGh(["pr", "view", String(number), "-R", repoName, "--json", "headRefName,headRepository,headRefOid"], token)).stdout
  ) as GhPrHead;
  const headRefName = prHead.headRefName;
  const headRepository = prHead.headRepository?.nameWithOwner ?? repoName;
  if (!headRefName) throw new Error(`Could not determine PR head branch for ${repoName}#${number}.`);

  const logs: CommandResult[] = [];
  let resolvedConflicts = 0;
  const repoDir = join(cacheDir, "rebase-worktrees", prKey(owner, repo, number));
  const run = async (command: string, args: string[], cwd = repoDir) => {
    const result = await runCommand(command, args, {
      cwd,
      env: { GH_TOKEN: token, GH_HOST: "github.com", GIT_EDITOR: "true" },
      redact: [token],
      timeoutMs: 15 * 60_000
    });
    logs.push(result);
    return result;
  };

  try {
    await mkdir(join(cacheDir, "rebase-worktrees"), { recursive: true });
    await rm(repoDir, { recursive: true, force: true });
    logs.push(await runCommand("gh", ["repo", "clone", repoName, repoDir], {
      env: { GH_TOKEN: token, GH_HOST: "github.com" },
      redact: [token],
      timeoutMs: 15 * 60_000
    }));
    await checkoutPrHead({ repoName, headRepository, headRefName, headRefOid: prHead.headRefOid, run });
    const originalHead = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
    await run("git", ["fetch", "origin", defaultBranch]);
    resolvedConflicts = await rebaseWithCodexResolution({ owner, repo, number, repoName, repoDir, defaultBranch, token, logs, run });
    const diff = await runCommand("git", ["diff", `${originalHead}..HEAD`], {
      cwd: repoDir,
      env: { GH_TOKEN: token, GH_HOST: "github.com", GIT_EDITOR: "true" },
      redact: [token],
      timeoutMs: 5 * 60_000
    });
    const previewId = randomUUID();
    rebasePreviews.set(previewId, {
      id: previewId,
      strategy: "rebase",
      owner,
      repo,
      number,
      repoName,
      repoDir,
      defaultBranch,
      headRefName,
      headRepository,
      conflictsResolved: resolvedConflicts,
      createdAt: new Date().toISOString()
    });
    return {
      success: true,
      strategy: "rebase",
      defaultBranch,
      stdout: logs.map((item) => item.stdout).filter(Boolean).join("\n"),
      stderr: logs.map((item) => item.stderr).filter(Boolean).join("\n"),
      previewId,
      diff: diff.stdout,
      repoDir,
      headRefName,
      headRepository,
      conflictsResolved: resolvedConflicts,
      message:
        resolvedConflicts > 0
          ? `Rebase preview ready for PR #${number}. Codex resolved ${resolvedConflicts} conflict step${resolvedConflicts === 1 ? "" : "s"}. Review the preview before approving push and retarget.`
          : `Rebase preview ready for PR #${number}. Review the preview before approving push and retarget.`
    };
  } catch (error) {
    const commandError = error instanceof CommandError ? error.result : undefined;
    if (commandError) logs.push(commandError);
    const diagnostics = await rebaseDiagnostics(repoDir).catch(() => undefined);
    return {
      success: false,
      strategy: "rebase",
      defaultBranch,
      stdout: logs.map((item) => item.stdout).filter(Boolean).join("\n"),
      stderr: [logs.map((item) => item.stderr).filter(Boolean).join("\n"), diagnostics].filter(Boolean).join("\n\n"),
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function mergePrTargetIntoHead(owner: string, repo: string, number: number): Promise<RebasePrResponse> {
  return prepareBranchUpdatePreview(owner, repo, number, "merge");
}

export async function updatePrBranch(owner: string, repo: string, number: number): Promise<RebasePrResponse> {
  const decision = await chooseBranchUpdateStrategy(owner, repo, number);
  const result = decision.strategy === "merge"
    ? await mergePrTargetIntoHead(owner, repo, number)
    : await rebasePrOntoDefault(owner, repo, number);
  return {
    ...result,
    strategy: decision.strategy,
    strategyReason: decision.reason,
    message: `${result.message}\n\nMNLens chose ${decision.strategy}: ${decision.reason}`
  };
}

async function chooseBranchUpdateStrategy(owner: string, repo: string, number: number): Promise<{ strategy: "rebase" | "merge"; reason: string }> {
  const token = await requireToken();
  const repoName = `${owner}/${repo}`;
  const raw = JSON.parse(
    (await runGh(["pr", "view", String(number), "-R", repoName, "--json", "baseRefName,changedFiles,commits,mergeStateStatus,title"], token)).stdout
  ) as {
    changedFiles?: number;
    commits?: unknown[];
    mergeStateStatus?: string;
    title?: string;
  };
  const changedFiles = Number(raw.changedFiles ?? 0);
  const commitCount = Array.isArray(raw.commits) ? raw.commits.length : 0;
  const mergeState = raw.mergeStateStatus ?? "unknown";

  if (changedFiles >= 80 || commitCount >= 25) {
    return {
      strategy: "merge",
      reason: `large PR (${changedFiles || "unknown"} files, ${commitCount || "unknown"} commits); merging the target branch avoids replaying every commit and is usually easier to review for conflict-heavy branches.`
    };
  }
  if (/dirty|blocked|unstable/i.test(mergeState) && (changedFiles >= 30 || commitCount >= 10)) {
    return {
      strategy: "merge",
      reason: `branch state is ${mergeState} and the PR is moderately large (${changedFiles || "unknown"} files, ${commitCount || "unknown"} commits); merge preview is less likely to get stuck in repeated rebase conflicts.`
    };
  }
  return {
    strategy: "rebase",
    reason: `small enough to keep linear history (${changedFiles || "unknown"} files, ${commitCount || "unknown"} commits, merge state ${mergeState}).`
  };
}

async function prepareBranchUpdatePreview(owner: string, repo: string, number: number, strategy: "merge"): Promise<RebasePrResponse> {
  const token = await requireToken();
  const repoName = `${owner}/${repo}`;
  const prHead = JSON.parse(
    (await runGh(["pr", "view", String(number), "-R", repoName, "--json", "baseRefName,headRefName,headRepository,headRefOid"], token)).stdout
  ) as GhPrHead & { baseRefName?: string; headRefOid?: string };
  const defaultBranch = prHead.baseRefName || (await runGh(["repo", "view", repoName, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], token)).stdout.trim();
  const headRefName = prHead.headRefName;
  const headRepository = prHead.headRepository?.nameWithOwner ?? repoName;
  if (!defaultBranch) throw new Error(`Could not determine target branch for ${repoName}#${number}.`);
  if (!headRefName) throw new Error(`Could not determine PR head branch for ${repoName}#${number}.`);

  const logs: CommandResult[] = [];
  let resolvedConflicts = 0;
  const repoDir = join(cacheDir, "merge-worktrees", prKey(owner, repo, number));
  const run = async (command: string, args: string[], cwd = repoDir) => {
    const result = await runCommand(command, args, {
      cwd,
      env: { GH_TOKEN: token, GH_HOST: "github.com", GIT_EDITOR: "true" },
      redact: [token],
      timeoutMs: 15 * 60_000
    });
    logs.push(result);
    return result;
  };

  try {
    await mkdir(join(cacheDir, "merge-worktrees"), { recursive: true });
    await rm(repoDir, { recursive: true, force: true });
    logs.push(await runCommand("gh", ["repo", "clone", repoName, repoDir], {
      env: { GH_TOKEN: token, GH_HOST: "github.com" },
      redact: [token],
      timeoutMs: 15 * 60_000
    }));
    await checkoutPrHead({ repoName, headRepository, headRefName, headRefOid: prHead.headRefOid, run });
    const originalHead = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
    await run("git", ["fetch", "origin", defaultBranch]);
    resolvedConflicts = await mergeWithCodexResolution({ owner, repo, number, repoName, repoDir, defaultBranch, token, logs, run });
    const diff = await runCommand("git", ["diff", `${originalHead}..HEAD`], {
      cwd: repoDir,
      env: { GH_TOKEN: token, GH_HOST: "github.com", GIT_EDITOR: "true" },
      redact: [token],
      timeoutMs: 5 * 60_000
    });
    const previewId = randomUUID();
    rebasePreviews.set(previewId, {
      id: previewId,
      strategy,
      owner,
      repo,
      number,
      repoName,
      repoDir,
      defaultBranch,
      headRefName,
      headRepository,
      conflictsResolved: resolvedConflicts,
      createdAt: new Date().toISOString()
    });
    return {
      success: true,
      strategy,
      defaultBranch,
      stdout: logs.map((item) => item.stdout).filter(Boolean).join("\n"),
      stderr: logs.map((item) => item.stderr).filter(Boolean).join("\n"),
      previewId,
      diff: diff.stdout,
      repoDir,
      headRefName,
      headRepository,
      conflictsResolved: resolvedConflicts,
      message:
        resolvedConflicts > 0
          ? `Merge preview ready for PR #${number}. Codex resolved ${resolvedConflicts} conflict step${resolvedConflicts === 1 ? "" : "s"}. Review the preview before approving push.`
          : `Merge preview ready for PR #${number}. Review the preview before approving push.`
    };
  } catch (error) {
    const commandError = error instanceof CommandError ? error.result : undefined;
    if (commandError) logs.push(commandError);
    const diagnostics = await rebaseDiagnostics(repoDir).catch(() => undefined);
    return {
      success: false,
      strategy,
      defaultBranch,
      stdout: logs.map((item) => item.stdout).filter(Boolean).join("\n"),
      stderr: [logs.map((item) => item.stderr).filter(Boolean).join("\n"), diagnostics].filter(Boolean).join("\n\n"),
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function confirmRebasePrOntoDefault(previewId: string): Promise<RebasePrResponse> {
  const token = await requireToken();
  const preview = rebasePreviews.get(previewId);
  if (!preview) throw new Error("Rebase preview not found. Prepare a fresh rebase preview.");
  if (!existsSync(join(preview.repoDir, ".git"))) {
    rebasePreviews.delete(previewId);
    throw new Error("Rebase preview workspace is missing. Prepare a fresh rebase preview.");
  }
  const logs: CommandResult[] = [];
  const run = async (command: string, args: string[]) => {
    const result = await runCommand(command, args, {
      cwd: preview.repoDir,
      env: { GH_TOKEN: token, GH_HOST: "github.com", GIT_EDITOR: "true" },
      redact: [token],
      timeoutMs: 15 * 60_000
    });
    logs.push(result);
    return result;
  };

  try {
    await run("git", ["remote", "remove", "pr-head"]).catch(() => undefined);
    await run("git", ["remote", "add", "pr-head", `https://github.com/${preview.headRepository}.git`]);
    await run("git", ["fetch", "pr-head", preview.headRefName]);
    await run("git", preview.strategy === "merge"
      ? ["push", "pr-head", `HEAD:${preview.headRefName}`]
      : ["push", "--force-with-lease", "pr-head", `HEAD:${preview.headRefName}`]);
    if (preview.strategy === "rebase") {
      await run("gh", ["api", "-X", "PATCH", `repos/${preview.owner}/${preview.repo}/pulls/${preview.number}`, "-f", `base=${preview.defaultBranch}`, "--hostname", "github.com"]);
    }
    await getPrDetail(preview.owner, preview.repo, preview.number);
    rebasePreviews.delete(previewId);
    return {
      success: true,
      strategy: preview.strategy,
      defaultBranch: preview.defaultBranch,
      stdout: logs.map((item) => item.stdout).filter(Boolean).join("\n"),
      stderr: logs.map((item) => item.stderr).filter(Boolean).join("\n"),
      previewId,
      repoDir: preview.repoDir,
      headRefName: preview.headRefName,
      headRepository: preview.headRepository,
      conflictsResolved: preview.conflictsResolved,
      pushed: true,
      message:
        preview.strategy === "merge"
          ? `Approved merge pushed to ${preview.headRepository}:${preview.headRefName}. PR #${preview.number} still targets ${preview.defaultBranch}.`
          : `Approved rebase pushed to ${preview.headRepository}:${preview.headRefName} and PR #${preview.number} now targets ${preview.defaultBranch}.`
    };
  } catch (error) {
    const commandError = error instanceof CommandError ? error.result : undefined;
    if (commandError) logs.push(commandError);
    return {
      success: false,
      strategy: preview.strategy,
      defaultBranch: preview.defaultBranch,
      stdout: logs.map((item) => item.stdout).filter(Boolean).join("\n"),
      stderr: logs.map((item) => item.stderr).filter(Boolean).join("\n"),
      previewId,
      repoDir: preview.repoDir,
      headRefName: preview.headRefName,
      headRepository: preview.headRepository,
      conflictsResolved: preview.conflictsResolved,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function checkoutPrHead(args: {
  repoName: string;
  headRepository: string;
  headRefName: string;
  headRefOid?: string;
  run: (command: string, commandArgs: string[], cwd?: string) => Promise<CommandResult>;
}): Promise<void> {
  if (args.headRepository !== args.repoName) {
    await args.run("git", ["remote", "remove", "pr-head"]).catch(() => undefined);
    await args.run("git", ["remote", "add", "pr-head", `https://github.com/${args.headRepository}.git`]);
    await args.run("git", ["fetch", "pr-head", args.headRefName]);
    await args.run("git", ["checkout", "-B", args.headRefName, "FETCH_HEAD"]);
    return;
  }
  await args.run("git", ["fetch", "origin", `refs/heads/${args.headRefName}:refs/remotes/origin/${args.headRefName}`]);
  await args.run("git", ["checkout", "-B", args.headRefName, `origin/${args.headRefName}`]);
  if (args.headRefOid) {
    const actual = (await args.run("git", ["rev-parse", "HEAD"])).stdout.trim();
    if (actual !== args.headRefOid) {
      await args.run("git", ["checkout", "--detach", args.headRefOid]);
    }
  }
}

async function rebaseWithCodexResolution(args: {
  owner: string;
  repo: string;
  number: number;
  repoName: string;
  repoDir: string;
  defaultBranch: string;
  token: string;
  logs: CommandResult[];
  run: (command: string, commandArgs: string[], cwd?: string) => Promise<CommandResult>;
}): Promise<number> {
  let resolved = 0;
  let result = await args.run("git", ["rebase", `origin/${args.defaultBranch}`]).catch((error) => {
    if (error instanceof CommandError) return error.result;
    throw error;
  });
  if (result.exitCode === 0) return resolved;
  args.logs.push(result);

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const conflicts = await conflictFiles(args.repoDir);
    if (conflicts.length === 0) throw new CommandError("git rebase failed without merge conflicts to resolve", result);

    const detail = await getPrDetail(args.owner, args.repo, args.number);
    const analysis = await readAnalysis(detail.key);
    const codexResult = await resolveConflictsWithCodex({ ...args, conflicts, detail, analysis, operation: "rebase" });
    args.logs.push(codexResult);

    const remainingMarkers = await conflictMarkerFiles(args.repoDir, conflicts);
    if (remainingMarkers.length > 0) {
      throw new CommandError(`Codex left conflict markers in: ${remainingMarkers.join(", ")}`, codexResult);
    }
    await args.run("git", ["add", "-A"]);
    const remainingConflicts = await conflictFiles(args.repoDir);
    if (remainingConflicts.length > 0) {
      throw new CommandError(`Codex did not stage all rebase conflict resolutions: ${remainingConflicts.join(", ")}`, codexResult);
    }
    resolved += 1;

    result = await continueOrSkipEmptyRebase(args);
    if (result.exitCode === 0) return resolved;
    args.logs.push(result);
  }

  throw new CommandError("Rebase still has conflicts after 6 Codex resolution attempts.", result);
}

async function mergeWithCodexResolution(args: {
  owner: string;
  repo: string;
  number: number;
  repoName: string;
  repoDir: string;
  defaultBranch: string;
  token: string;
  logs: CommandResult[];
  run: (command: string, commandArgs: string[], cwd?: string) => Promise<CommandResult>;
}): Promise<number> {
  let resolved = 0;
  const result = await args.run("git", ["merge", "--no-ff", "--no-edit", `origin/${args.defaultBranch}`]).catch((error) => {
    if (error instanceof CommandError) return error.result;
    throw error;
  });
  if (result.exitCode === 0) return resolved;
  args.logs.push(result);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const conflicts = await conflictFiles(args.repoDir);
    if (conflicts.length === 0) throw new CommandError("git merge failed without merge conflicts to resolve", result);
    const detail = await getPrDetail(args.owner, args.repo, args.number);
    const analysis = await readAnalysis(detail.key);
    const codexResult = await resolveConflictsWithCodex({ ...args, conflicts, detail, analysis, operation: "merge" });
    args.logs.push(codexResult);
    const remainingMarkers = await conflictMarkerFiles(args.repoDir, conflicts);
    if (remainingMarkers.length > 0) {
      throw new CommandError(`Codex left conflict markers in: ${remainingMarkers.join(", ")}`, codexResult);
    }
    await args.run("git", ["add", "-A"]);
    const remainingConflicts = await conflictFiles(args.repoDir);
    if (remainingConflicts.length > 0) {
      throw new CommandError(`Codex did not stage all merge conflict resolutions: ${remainingConflicts.join(", ")}`, codexResult);
    }
    await args.run("git", ["commit", "--no-edit"]);
    resolved += 1;
    return resolved;
  }

  throw new CommandError("Merge still has conflicts after Codex resolution attempts.", result);
}

async function resolveConflictsWithCodex(args: {
  repoName: string;
  number: number;
  repoDir: string;
  defaultBranch: string;
  conflicts: string[];
  token: string;
  operation: "rebase" | "merge";
  detail?: unknown;
  analysis?: unknown;
}): Promise<CommandResult> {
  await ensureCodexHome();
  const detail = args.detail ?? await getPrDetail(args.repoName.split("/")[0] ?? "", args.repoName.split("/")[1] ?? "", args.number);
  const analysis = args.analysis ?? await readAnalysis(prKey(args.repoName.split("/")[0] ?? "", args.repoName.split("/")[1] ?? "", args.number));
  return runCommand(
    "codex",
    ["--ask-for-approval", "never", "exec", "--skip-git-repo-check", "--sandbox", "danger-full-access", "-"],
    {
      cwd: args.repoDir,
      input: buildRebaseConflictPrompt({
        repoName: args.repoName,
        number: args.number,
        defaultBranch: args.defaultBranch,
        conflicts: args.conflicts,
        detail,
        analysis,
        operation: args.operation
      }),
      env: { CODEX_HOME: codexHome, GH_TOKEN: args.token, GH_HOST: "github.com" },
      timeoutMs: 20 * 60_000,
      redact: [args.token]
    }
  );
}

async function continueOrSkipEmptyRebase(args: {
  logs: CommandResult[];
  run: (command: string, commandArgs: string[], cwd?: string) => Promise<CommandResult>;
}): Promise<CommandResult> {
  const result = await args.run("git", ["rebase", "--continue"]).catch((error) => {
    if (error instanceof CommandError) return error.result;
    throw error;
  });
  if (result.exitCode === 0 || !isEmptyRebaseStep(result)) return result;
  args.logs.push(result);
  return args.run("git", ["rebase", "--skip"]).catch((error) => {
    if (error instanceof CommandError) return error.result;
    throw error;
  });
}

function isEmptyRebaseStep(result: CommandResult): boolean {
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return text.includes("no changes") || text.includes("previous cherry-pick is now empty") || text.includes("patch contents already upstream");
}

async function conflictFiles(repoDir: string): Promise<string[]> {
  const result = await runCommand("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: repoDir }).catch((error) => {
    if (error instanceof CommandError) return error.result;
    throw error;
  });
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function conflictMarkerFiles(repoDir: string, files: string[]): Promise<string[]> {
  const markerPattern = "^(<<<<<<<|=======|>>>>>>>)";
  const result = await runCommand("rg", ["-n", markerPattern, ...files], { cwd: repoDir }).catch((error) => {
    if (error instanceof CommandError) return error.result;
    throw error;
  });
  if (result.exitCode === 1) return [];
  return [...new Set(result.stdout
    .split("\n")
    .map((line) => line.split(":")[0]?.trim())
    .filter(Boolean))];
}

function buildRebaseConflictPrompt(args: {
  repoName: string;
  number: number;
  defaultBranch: string;
  conflicts: string[];
  detail: unknown;
  analysis: unknown;
  operation: "rebase" | "merge";
}): string {
  const prContext = boundedJson(compactRebaseDetail(args.detail, args.conflicts), 70_000);
  const reviewContext = boundedJson(compactRebaseAnalysis(args.analysis), 35_000);
  return `You are resolving a Git ${args.operation} conflict for a GitHub PR inside a checked-out worktree.

Repository: ${args.repoName}
PR: #${args.number}
Target base branch: ${args.defaultBranch}
Conflicted files:
${args.conflicts.map((file) => `- ${file}`).join("\n")}

Rules:
- Resolve only the current ${args.operation} conflicts.
- Preserve the PR intent and all already-reviewed fixes.
- Preserve changes from the target base branch unless they directly conflict with the PR intent.
- Do not add unrelated refactors.
- Remove all conflict markers.
- Do not run git rebase, git merge, git commit, git push, or destructive git commands.
- After editing, inspect the conflicted files and stop. The app will stage files and ${args.operation === "merge" ? "create the merge preview commit" : "continue the rebase"}, then show a preview for human approval before any push.

PR context:
${prContext}

AI review context:
${reviewContext === "null" ? "No cached AI review context was available. Resolve the conflict from the local files, PR context, target branch, and PR intent." : reviewContext}
`;
}

function compactRebaseDetail(detail: unknown, conflicts: string[]): unknown {
  if (!detail || typeof detail !== "object") return detail;
  const source = detail as Record<string, unknown>;
  const conflictSet = new Set(conflicts);
  return {
    title: source.title,
    body: truncateText(source.body, 6000),
    baseRefName: source.baseRefName,
    headRefName: source.headRefName,
    changedFiles: source.changedFiles,
    additions: source.additions,
    deletions: source.deletions,
    linkedIssues: compactArray(source.linkedIssues, 3, (issue) => compactObject(issue, ["number", "title", "url", "state", "body"], 3000)),
    files: compactArray(source.files, 250, (file) => compactObject(file, ["path", "additions", "deletions", "changeType"])),
    conflictingFiles: compactArray(source.files, 100, (file) => compactObject(file, ["path", "additions", "deletions", "changeType"]), (file) =>
      conflictSet.has(String((file as Record<string, unknown>).path ?? ""))
    ),
    reviewComments: compactArray(source.reviewComments, 60, (comment) => compactObject(comment, ["path", "line", "body", "author"], 2500), (comment) =>
      conflictSet.has(String((comment as Record<string, unknown>).path ?? ""))
    ),
    conversationComments: compactArray(source.conversationComments, 20, (comment) => compactObject(comment, ["body", "author"], 2500)),
    commits: compactArray(source.commits, 120, (commit) => compactObject(commit, ["shortSha", "message", "author", "committedAt"]))
  };
}

function compactRebaseAnalysis(analysis: unknown): unknown {
  if (!analysis || typeof analysis !== "object") return analysis;
  const source = analysis as Record<string, unknown>;
  return {
    type: source.type,
    summary: source.summary,
    reviewerFocus: source.reviewerFocusDetails ?? source.reviewerFocus,
    risks: source.riskDetails ?? source.risks,
    testsToCheck: source.testsToCheck,
    testAssessment: source.testAssessment
  };
}

function boundedJson(value: unknown, limit: number): string {
  const text = JSON.stringify(value ?? null, null, 2) ?? "null";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1200))}\n... truncated for Codex rebase context limit ...\n${JSON.stringify({
    note: "MNLens truncated this PR context because the PR is very large. Resolve only the currently conflicted files shown above and inspect the local files for exact code."
  }, null, 2)}`;
}

function compactArray<T = unknown>(
  value: unknown,
  limit: number,
  mapItem: (item: T) => unknown,
  filterItem?: (item: T) => boolean
): unknown[] {
  if (!Array.isArray(value)) return [];
  const items = filterItem ? (value as T[]).filter(filterItem) : (value as T[]);
  return items.slice(0, limit).map(mapItem);
}

function compactObject(value: unknown, keys: string[], textLimit = 1000): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const item = source[key];
    if (typeof item === "string") {
      result[key] = truncateText(item, textLimit);
    } else if (item !== undefined) {
      result[key] = item;
    }
  }
  return result;
}

function truncateText(value: unknown, limit: number): unknown {
  if (typeof value !== "string" || value.length <= limit) return value;
  return `${value.slice(0, limit)}... [truncated]`;
}

async function rebaseDiagnostics(repoDir: string): Promise<string> {
  if (!existsSync(join(repoDir, ".git"))) return "";
  const [status, unmerged] = await Promise.all([
    runCommand("git", ["status"], { cwd: repoDir }).catch((error) => (error instanceof CommandError ? error.result : undefined)),
    runCommand("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: repoDir }).catch((error) => (error instanceof CommandError ? error.result : undefined))
  ]);
  return [
    status?.stdout ? `Current rebase status:\n${status.stdout}` : "",
    unmerged?.stdout?.trim() ? `Unmerged files:\n${unmerged.stdout.trim()}` : ""
  ].filter(Boolean).join("\n\n");
}

async function searchQueue(queue: PrQueue, token: string): Promise<PrListItem[]> {
  const args =
    queue === "assigned"
      ? ["search", "prs", "--assignee=@me", "--state=open", "--archived=false", "--limit=100", "--json", searchFields]
      : queue === "review-requested"
        ? [
          "search",
          "prs",
          "--review-requested=@me",
          "--state=open",
          "--archived=false",
          "--limit=100",
            "--json",
            searchFields
          ]
        : queue === "reviewed"
          ? ["search", "prs", "--reviewed-by=@me", "--state=open", "--archived=false", "--limit=100", "--json", searchFields]
        : ["search", "prs", "--author=@me", "--state=open", "--archived=false", "--limit=100", "--json", searchFields];
  const result = await runGh(args, token);
  const raw = JSON.parse(result.stdout) as GhSearchPr[];
  return raw.map((item) => normalizeSearchItem(item, queue));
}

function normalizeSearchItem(item: GhSearchPr, queue: PrQueue): PrListItem {
  const fullName = item.repository?.nameWithOwner ?? item.repository?.fullName ?? "";
  const [owner = "", repo = ""] = fullName.split("/");
  const key = prKey(owner, repo, item.number);
  return {
    key,
    owner,
    repo,
    number: item.number,
    title: item.title ?? "",
    url: item.url ?? `https://github.com/${fullName}/pull/${item.number}`,
    repository: fullName,
    author: item.author?.login ?? "unknown",
    authorUrl: item.author?.url ?? (item.author?.login ? `https://github.com/${item.author.login}` : undefined),
    labels: normalizeLabels(item.labels),
    queues: [queue],
    state: item.state ?? "UNKNOWN",
    isDraft: Boolean(item.isDraft),
    createdAt: item.createdAt ?? "",
    updatedAt: item.updatedAt ?? "",
    commentsCount: item.commentsCount ?? 0
  };
}

async function fetchConversationComments(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<ExistingComment[]> {
  const result = await runGh(["api", `repos/${owner}/${repo}/issues/${number}/comments`, "--hostname", "github.com"], token);
  const raw = JSON.parse(result.stdout) as GhIssueComment[];
  return raw.map((comment) => ({
    id: comment.id,
    author: comment.user?.login ?? "unknown",
    authorUrl: comment.user?.html_url,
    url: comment.html_url ?? "",
    body: comment.body ?? "",
    createdAt: comment.created_at ?? ""
  }));
}

async function fetchReviewComments(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<ExistingReviewComment[]> {
  const [result, resolvedThreads] = await Promise.all([
    runGh(["api", `repos/${owner}/${repo}/pulls/${number}/comments`, "--hostname", "github.com"], token),
    fetchReviewThreadResolution(token, owner, repo, number).catch(() => new Map<number, boolean>())
  ]);
  const raw = JSON.parse(result.stdout) as GhReviewComment[];
  return raw.map((comment) => ({
    id: comment.id,
    author: comment.user?.login ?? "unknown",
    authorUrl: comment.user?.html_url,
    url: comment.html_url ?? "",
    body: comment.body ?? "",
    createdAt: comment.created_at ?? "",
    path: comment.path ?? "",
    line: comment.line,
    originalLine: comment.original_line,
    side: comment.side,
    isResolved: resolvedThreads.get(comment.id)
  }));
}

async function fetchReviewThreadResolution(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<Map<number, boolean>> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes {
              isResolved
              comments(first: 50) {
                nodes {
                  databaseId
                }
              }
            }
          }
        }
      }
    }
  `;
  const result = await runGh(
    ["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `repo=${repo}`, "-F", `number=${number}`, "--hostname", "github.com"],
    token
  );
  const raw = JSON.parse(result.stdout) as {
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            nodes?: Array<{
              isResolved?: boolean;
              comments?: { nodes?: Array<{ databaseId?: number }> };
            }>;
          };
        };
      };
    };
  };
  const resolutions = new Map<number, boolean>();
  for (const thread of raw.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []) {
    for (const comment of thread.comments?.nodes ?? []) {
      if (typeof comment.databaseId === "number") resolutions.set(comment.databaseId, Boolean(thread.isResolved));
    }
  }
  return resolutions;
}

async function fetchReviewSummaries(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<ExistingReviewSummary[]> {
  const result = await runGh(["api", `repos/${owner}/${repo}/pulls/${number}/reviews`, "--hostname", "github.com"], token);
  const raw = JSON.parse(result.stdout) as GhReview[];
  return raw
    .filter((review) => (review.body ?? "").trim().length > 0)
    .map((review) => ({
      id: review.id,
      author: review.user?.login ?? "unknown",
      authorUrl: review.user?.html_url,
      url: review.html_url ?? "",
      body: review.body ?? "",
      createdAt: review.submitted_at ?? "",
      state: review.state ?? "COMMENTED"
    }));
}

function normalizeLabels(labels: GhLabel[] | undefined): string[] {
  return (labels ?? []).map((label) => label.name).filter(Boolean);
}

function normalizeFiles(files: GhFile[] | undefined): PrFile[] {
  return (files ?? []).map((file) => ({
    path: file.path ?? "",
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    changeType: file.changeType
  }));
}

function normalizeReviewerStatuses(raw: GhPrView): PrReviewerStatus[] {
  const reviewers = new Map<string, PrReviewerStatus>();
  for (const review of raw.latestReviews ?? []) {
    const login = review.author?.login;
    if (!login) continue;
    reviewers.set(login.toLowerCase(), {
      login,
      url: review.author?.url ?? `https://github.com/${login}`,
      status: normalizeReviewState(review.state),
      source: "review",
      submittedAt: review.submittedAt
    });
  }
  for (const request of raw.reviewRequests ?? []) {
    const login = request.login ?? request.slug ?? request.name;
    if (!login) continue;
    const key = login.toLowerCase();
    if (reviewers.has(key)) continue;
    reviewers.set(key, {
      login,
      url: request.url ?? (request.__typename === "User" ? `https://github.com/${login}` : undefined),
      status: "PENDING",
      source: "request"
    });
  }
  return [...reviewers.values()].sort((left, right) => reviewerSort(left) - reviewerSort(right) || left.login.localeCompare(right.login));
}

function normalizeReviewState(state: string | undefined): PrReviewerStatus["status"] {
  if (state === "APPROVED") return "APPROVED";
  if (state === "CHANGES_REQUESTED") return "CHANGES_REQUESTED";
  if (state === "COMMENTED") return "COMMENTED";
  if (state === "DISMISSED") return "DISMISSED";
  return "UNKNOWN";
}

function reviewerSort(item: PrReviewerStatus): number {
  if (item.status === "CHANGES_REQUESTED") return 0;
  if (item.status === "PENDING") return 1;
  if (item.status === "APPROVED") return 2;
  if (item.status === "COMMENTED") return 3;
  return 4;
}

function normalizeLinkedIssues(issues: GhLinkedIssue[] | undefined, fallbackRepository: string): LinkedIssue[] {
  return (issues ?? [])
    .filter((issue) => issue.number !== undefined || issue.url || issue.title)
    .map((issue) => ({
      number: issue.number ?? issueNumberFromUrl(issue.url) ?? 0,
      title: issue.title ?? "Linked issue",
      url: issue.url ?? "",
      nodeId: issue.id,
      state: issue.state,
      repository: issue.repository?.nameWithOwner ?? issueRepositoryFromUrl(issue.url) ?? fallbackRepository
    }));
}

function issueNumberFromUrl(url: string | undefined): number | undefined {
  const match = /\/issues\/(\d+)(?:$|[?#])/.exec(url ?? "");
  return match ? Number(match[1]) : undefined;
}

function issueRepositoryFromUrl(url: string | undefined): string | undefined {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/\d+(?:$|[?#])/.exec(url ?? "");
  return match?.[1];
}

async function enrichLinkedIssues(token: string, issues: LinkedIssue[]): Promise<LinkedIssue[]> {
  return Promise.all(
    issues.map(async (issue) => {
      if (!issue.repository || !issue.number) return issue;
      try {
        const result = await runGh(["issue", "view", String(issue.number), "-R", issue.repository, "--json", "id,number,title,url,state,body,author,comments,labels,createdAt,updatedAt"], token);
        const raw = JSON.parse(result.stdout) as GhIssueView;
        return {
          ...issue,
          number: raw.number ?? issue.number,
          title: raw.title ?? issue.title,
          url: raw.url ?? issue.url,
          nodeId: raw.id ?? issue.nodeId,
          state: raw.state ?? issue.state,
          body: raw.body ?? issue.body,
          author: raw.author?.login,
          authorUrl: raw.author?.url ?? (raw.author?.login ? `https://github.com/${raw.author.login}` : undefined),
          commentsCount: Array.isArray(raw.comments) ? raw.comments.length : issue.commentsCount,
          labels: normalizeLabels(raw.labels as GhLabel[] | undefined),
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt
        };
      } catch {
        return issue;
      }
    })
  );
}

async function fetchPrCommits(token: string, owner: string, repo: string, number: number): Promise<PrCommit[]> {
  const result = await runGh(["api", `repos/${owner}/${repo}/pulls/${number}/commits`, "--paginate", "--hostname", "github.com"], token);
  const raw = JSON.parse(result.stdout) as GhPullCommit[];
  const commits = await Promise.all(
    raw.map(async (commit) => {
      const sha = commit.sha ?? "";
      const detail = sha ? await fetchCommitFiles(token, owner, repo, sha) : [];
      return {
        sha,
        shortSha: sha.slice(0, 7),
        message: firstLine(commit.commit?.message ?? ""),
        author: commit.author?.login ?? commit.commit?.author?.name ?? "unknown",
        authorUrl: commit.author?.html_url,
        authoredAt: commit.commit?.author?.date ?? "",
        committer: commit.committer?.login ?? commit.commit?.committer?.name ?? "unknown",
        committedAt: commit.commit?.committer?.date ?? commit.commit?.author?.date ?? "",
        url: commit.html_url ?? "",
        files: detail
      };
    })
  );
  return commits;
}

async function fetchCommitFiles(token: string, owner: string, repo: string, sha: string): Promise<PrCommitFile[]> {
  const result = await runGh(["api", `repos/${owner}/${repo}/commits/${sha}`, "--hostname", "github.com"], token);
  const raw = JSON.parse(result.stdout) as GhCommitDetail;
  return (raw.files ?? []).map((file) => ({
    path: file.filename ?? "",
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    changeType: file.status?.toUpperCase(),
    previousPath: file.previous_filename,
    patch: file.patch
  }));
}

function firstLine(value: string): string {
  return value.split("\n")[0]?.trim() ?? "";
}

function queueMembership(raw: GhPrView): PrQueue[] {
  const queues: PrQueue[] = [];
  if ((raw.assignees ?? []).length > 0) queues.push("assigned");
  if ((raw.reviewRequests ?? []).length > 0) queues.push("review-requested");
  if ((raw.latestReviews ?? []).length > 0) queues.push("reviewed");
  return queues;
}

async function requireToken(): Promise<string> {
  const token = await readGithubToken();
  if (!token) throw new Error(missingGithubTokenMessage());
  return token;
}

async function getAuthenticatedUsername(token: string): Promise<string> {
  const result = await runGh(["api", "user", "--jq", ".login"], token);
  return result.stdout.trim();
}

async function runGh(args: string[], token: string, input?: string) {
  assertGithubRateLimitAvailable();
  try {
    return await runCommand("gh", args, {
      env: { GH_TOKEN: token, GH_HOST: "github.com" },
      input,
      redact: [token],
      timeoutMs: 120_000
    });
  } catch (error) {
    if (error instanceof CommandError) {
      const output = [error.message, error.result.stderr, error.result.stdout].filter(Boolean).join("\n");
      if (noteGithubRateLimit(output)) {
        assertGithubRateLimitAvailable();
      }
    }
    throw error;
  }
}

async function fetchGithubRateLimit(token: string) {
  if (rateLimitCache && Date.now() - rateLimitCache.fetchedAt < 60_000) return rateLimitCache.status;
  if (githubRateLimitStatus().limited) return githubRateLimitStatus();
  const result = await runGh(["api", "rate_limit"], token);
  try {
    noteGithubRateLimitBody(JSON.parse(result.stdout));
  } catch {
    // Keep the last known header-derived state.
  }
  rateLimitCache = { fetchedAt: Date.now(), status: githubRateLimitStatus() };
  return rateLimitCache.status;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await runCommand("command", ["-v", command]);
    return true;
  } catch {
    try {
      await runCommand("which", [command]);
      return true;
    } catch {
      return false;
    }
  }
}

function commandErrorText(error: unknown): string {
  if (error instanceof CommandError) return [error.result.stderr, error.result.stdout].filter(Boolean).join("\n").trim();
  return error instanceof Error ? error.message : String(error);
}

function commandOutput(error: CommandError): string {
  return [error.result.stderr, error.result.stdout].filter(Boolean).join("\n").trim();
}

function isActionsLogPending(error: CommandError): boolean {
  return /run \d+ is still in progress; logs will be available when it is complete/i.test(commandOutput(error));
}

interface GhUser {
  login?: string;
  url?: string;
  html_url?: string;
}

interface GhLabel {
  name: string;
}

interface GhRepository {
  nameWithOwner?: string;
  fullName?: string;
}

interface GhSearchPr {
  author?: GhUser;
  commentsCount?: number;
  createdAt?: string;
  id?: string;
  isDraft?: boolean;
  labels?: GhLabel[];
  number: number;
  repository?: GhRepository;
  state?: string;
  title?: string;
  updatedAt?: string;
  url?: string;
}

interface GhFile {
  path?: string;
  additions?: number;
  deletions?: number;
  changeType?: string;
}

interface GhPrView extends GhSearchPr {
  additions?: number;
  assignees?: GhUser[];
  baseRefName?: string;
  body?: string;
  changedFiles?: number;
  closingIssuesReferences?: GhLinkedIssue[];
  comments?: unknown[];
  deletions?: number;
  files?: GhFile[];
  headRefName?: string;
  headRefOid?: string;
  mergeStateStatus?: string;
  latestReviews?: GhLatestReview[];
  reviewDecision?: string;
  reviewRequests?: GhReviewRequest[];
}

interface GhLatestReview {
  author?: {
    login?: string;
    url?: string;
  };
  state?: string;
  submittedAt?: string;
}

interface GhReviewRequest {
  __typename?: string;
  login?: string;
  slug?: string;
  name?: string;
  url?: string;
}

interface GhProjectV2 {
  id?: string;
  title?: string;
  url?: string;
  number?: number;
}

interface GhLinkedIssue {
  number?: number;
  title?: string;
  url?: string;
  id?: string;
  state?: string;
  repository?: {
    nameWithOwner?: string;
  };
}

interface GhIssueView extends GhLinkedIssue {
  body?: string;
  author?: GhUser;
  comments?: unknown[];
  labels?: GhLabel[];
  createdAt?: string;
  updatedAt?: string;
}

interface GhIssueComment {
  id: number;
  user?: GhUser;
  html_url?: string;
  body?: string;
  created_at?: string;
}

interface GhReviewComment extends GhIssueComment {
  path?: string;
  line?: number;
  original_line?: number;
  side?: "LEFT" | "RIGHT";
}

interface GhReview {
  id: number;
  user?: GhUser;
  html_url?: string;
  body?: string;
  submitted_at?: string;
  state?: string;
}

interface GhPrHead {
  headRefName?: string;
  headRefOid?: string;
  headRepository?: {
    nameWithOwner?: string;
  };
}

interface GhPullCommit {
  sha?: string;
  html_url?: string;
  author?: GhUser | null;
  committer?: GhUser | null;
  commit?: {
    message?: string;
    author?: {
      name?: string;
      date?: string;
    };
    committer?: {
      name?: string;
      date?: string;
    };
  };
}

interface GhCommitDetail {
  files?: Array<{
    filename?: string;
    previous_filename?: string;
    additions?: number;
    deletions?: number;
    status?: string;
    patch?: string;
  }>;
}

interface GhCiCheck {
  name?: string;
  workflow?: string;
  state?: string;
  bucket?: string;
  description?: string;
  link?: string;
  startedAt?: string;
  completedAt?: string;
}

interface GhCheckRunList {
  check_runs?: GhCheckRun[];
}

interface GhCheckRun {
  id?: number;
  name?: string;
  html_url?: string;
  details_url?: string;
  output?: {
    title?: string | null;
    summary?: string | null;
    text?: string | null;
    annotations_count?: number;
    annotations_url?: string | null;
  };
}

interface GhCheckRunAnnotation {
  path?: string;
  start_line?: number;
  end_line?: number;
  annotation_level?: string;
  title?: string;
  message?: string;
  raw_details?: string | null;
}

interface EnrichedCheckRun {
  id: number;
  htmlUrl: string;
  detailsUrl: string;
  title: string;
  summary: string;
  text: string;
  annotations: GhCheckRunAnnotation[];
}

function shouldEnrichCheckRuns(checks: GhCiCheck[]): boolean {
  return checks.some((check) => {
    const text = `${check.name ?? ""} ${check.workflow ?? ""} ${check.description ?? ""} ${check.link ?? ""}`.toLowerCase();
    const failed = check.bucket === "fail" || /fail|error|cancel/i.test(check.state ?? "");
    return failed && !parseActionsJobLink(check.link ?? "") && (text.includes("sonar") || text.includes("quality") || isGenericExternalCheckLink(check.link ?? ""));
  });
}

async function fetchCheckRunDetails(token: string, owner: string, repo: string, number: number): Promise<Map<string, EnrichedCheckRun>> {
  const repoName = `${owner}/${repo}`;
  const pr = await runGh(["pr", "view", String(number), "-R", repoName, "--json", "headRefOid"], token);
  const headRefOid = (JSON.parse(pr.stdout) as { headRefOid?: string }).headRefOid;
  if (!headRefOid) return new Map();
  const result = await runGh(["api", "-X", "GET", `repos/${owner}/${repo}/commits/${headRefOid}/check-runs`, "-F", "per_page=100", "--hostname", "github.com"], token);
  const raw = JSON.parse(result.stdout) as GhCheckRunList;
  const entries = await Promise.all((raw.check_runs ?? []).map(async (checkRun) => enrichCheckRun(token, owner, repo, checkRun)));
  return new Map(entries.flatMap((item) => (item ? [[item.name, item.run] as const] : [])));
}

async function enrichCheckRun(token: string, owner: string, repo: string, checkRun: GhCheckRun): Promise<{ name: string; run: EnrichedCheckRun } | undefined> {
  const id = checkRun.id;
  const name = checkRun.name;
  if (!id || !name) return undefined;
  const annotationsCount = checkRun.output?.annotations_count ?? 0;
  const annotations = annotationsCount > 0 ? await fetchCheckRunAnnotations(token, owner, repo, id).catch(() => []) : [];
  return {
    name,
    run: {
      id,
      htmlUrl: checkRun.html_url ?? "",
      detailsUrl: checkRun.details_url ?? "",
      title: checkRun.output?.title ?? "",
      summary: checkRun.output?.summary ?? "",
      text: checkRun.output?.text ?? "",
      annotations
    }
  };
}

async function fetchCheckRunAnnotations(token: string, owner: string, repo: string, id: number): Promise<GhCheckRunAnnotation[]> {
  const result = await runGh(["api", "-X", "GET", `repos/${owner}/${repo}/check-runs/${id}/annotations`, "-F", "per_page=100", "--hostname", "github.com"], token);
  return JSON.parse(result.stdout) as GhCheckRunAnnotation[];
}

async function fetchCheckRunOutput(token: string, owner: string, repo: string, id: string): Promise<string> {
  const [run, annotations] = await Promise.all([
    runGh(["api", `repos/${owner}/${repo}/check-runs/${id}`, "--hostname", "github.com"], token),
    runGh(["api", "-X", "GET", `repos/${owner}/${repo}/check-runs/${id}/annotations`, "-F", "per_page=100", "--hostname", "github.com"], token).catch(() => ({ stdout: "[]" }))
  ]);
  const checkRun = JSON.parse(run.stdout) as GhCheckRun;
  const checkAnnotations = JSON.parse(annotations.stdout) as GhCheckRunAnnotation[];
  return [
    `${checkRun.name ?? "Check run"}${checkRun.output?.title ? `: ${checkRun.output.title}` : ""}`,
    checkRun.output?.summary ? markdownToPlainText(checkRun.output.summary) : "",
    checkRun.output?.text ? markdownToPlainText(checkRun.output.text) : "",
    formatCheckAnnotations(checkAnnotations)
  ].filter(Boolean).join("\n\n");
}

function checkRunDescription(check: GhCiCheck, run: EnrichedCheckRun | undefined): string {
  const parts = [check.description ?? ""];
  if (run?.title) parts.push(run.title);
  const summary = run?.summary ? markdownToPlainText(run.summary) : "";
  if (summary) parts.push(summary);
  const annotations = run?.annotations ? formatCheckAnnotations(run.annotations) : "";
  if (annotations) parts.push(annotations);
  return truncate(parts.filter(Boolean).join("\n\n"), 1200);
}

function checkRunDetails(run: EnrichedCheckRun | undefined): string | undefined {
  if (!run) return undefined;
  return truncate([
    run.title,
    markdownToPlainText(run.summary),
    markdownToPlainText(run.text),
    formatCheckAnnotations(run.annotations)
  ].filter(Boolean).join("\n\n"), 12_000) || undefined;
}

function checkRunLink(owner: string, repo: string, number: number, check: GhCiCheck, run: EnrichedCheckRun | undefined): string {
  if (run?.id) return `https://github.com/${owner}/${repo}/pull/${number}/checks?check_run_id=${run.id}`;
  return check.link ?? "";
}

function parseCheckRunLink(link: string): string | undefined {
  return /[?&]check_run_id=(\d+)/.exec(link)?.[1] ?? /\/runs\/(\d+)(?:\b|\/|\?)/.exec(link)?.[1];
}

function isGenericExternalCheckLink(link: string): boolean {
  if (!link) return false;
  try {
    const url = new URL(link);
    return !url.hostname.endsWith("github.com");
  } catch {
    return false;
  }
}

function formatCheckAnnotations(annotations: GhCheckRunAnnotation[]): string {
  return annotations.map((annotation) => {
    const location = [annotation.path, annotation.start_line ? `line ${annotation.start_line}` : ""].filter(Boolean).join(":");
    return [
      location ? `Annotation at ${location}` : "Annotation",
      annotation.annotation_level ? `(${annotation.annotation_level})` : "",
      annotation.title,
      annotation.message ? markdownToPlainText(annotation.message) : "",
      annotation.raw_details ?? ""
    ].filter(Boolean).join(" ");
  }).join("\n");
}

function markdownToPlainText(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/[*`>#]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n\n[Output truncated from ${value.length} characters.]` : value;
}

function parseActionsJobLink(link: string): { runId: string; jobId: string } | undefined {
  const match = /\/actions\/runs\/(\d+)\/job\/(\d+)/.exec(link);
  if (!match) return undefined;
  return { runId: match[1], jobId: match[2] };
}

function fastType(title: string, labels: string[], files: PrFile[]): AnalysisType {
  const text = `${title} ${labels.join(" ")}`.toLowerCase();
  if (files.length > 0 && files.every((file) => isDocsPath(file.path))) return "docs";
  if (files.length > 0 && files.every((file) => isTestPath(file.path))) return "test";
  if (/\b(bug|fix|failure|broken|regression|npe|exception|crash)\b/.test(text)) return "bug";
  if (/\b(doc|docs|documentation|readme|guide)\b/.test(text)) return "docs";
  if (/\b(test|spec|coverage)\b/.test(text)) return "test";
  if (/\b(refactor|cleanup|rename|restructure)\b/.test(text)) return "refactor";
  if (/\b(improve|enhance|optimi[sz]e|support|customi[sz]e)\b/.test(text)) return "improvement";
  if (/\b(add|new|feature|introduce|implement|telemetry|integration)\b/.test(text)) return "feature";
  return "unknown";
}

function fastRiskCount(args: {
  additions: number;
  changedFiles: number;
  deletions: number;
  files: PrFile[];
  isDraft: boolean;
  mergeStateStatus?: string;
  reviewDecision?: string;
  type: AnalysisType;
}): number {
  let risk = 0;
  const changedLines = args.additions + args.deletions;
  const sourceFiles = args.files.filter((file) => !isDocsPath(file.path) && !isTestPath(file.path)).length;
  if (args.isDraft) risk += 1;
  if (args.reviewDecision === "CHANGES_REQUESTED") risk += 2;
  if (args.mergeStateStatus && /blocked|dirty|behind|unstable/i.test(args.mergeStateStatus)) risk += 2;
  if (sourceFiles > 0 && !["docs", "test"].includes(args.type)) risk += 1;
  if (args.changedFiles > 8) risk += 1;
  if (args.changedFiles > 16) risk += 1;
  if (changedLines > 250) risk += 1;
  if (changedLines > 700) risk += 1;
  if (args.files.some((file) => /security|auth|token|credential|secret|permission/i.test(file.path))) risk += 2;
  return Math.min(7, risk);
}

function fastTestsCount(type: AnalysisType, files: PrFile[], changedLines: number, riskCount: number): number {
  if (type === "docs") return 1;
  if (type === "test") return 1;
  const hasSource = files.some((file) => !isDocsPath(file.path) && !isTestPath(file.path));
  const hasTests = files.some((file) => isTestPath(file.path));
  if (!hasSource) return 0;
  let count = hasTests ? 1 : 2;
  if ((type === "feature" || type === "bug") && !hasTests) count += 1;
  if (changedLines > 400 || riskCount >= 4) count += 1;
  return Math.min(5, count);
}

function fastScoreFor(args: {
  additions: number;
  changedFiles: number;
  deletions: number;
  isDraft: boolean;
  mergeStateStatus?: string;
  reviewDecision?: string;
  riskCount: number;
  testsCount: number;
  type: AnalysisType;
}): { score: number; label: string; tone: string } {
  let score = 92;
  const changedLines = args.additions + args.deletions;
  if (args.type === "docs" && args.changedFiles <= 3 && changedLines <= 120) score += 6;
  if (args.isDraft) score -= 14;
  if (args.reviewDecision === "CHANGES_REQUESTED") score -= 12;
  if (args.mergeStateStatus && /blocked|dirty|behind|unstable/i.test(args.mergeStateStatus)) score -= 18;
  score -= Math.min(24, args.riskCount * 4);
  score -= Math.min(12, args.testsCount * 2);
  if (args.changedFiles > 12 || changedLines > 700) score -= 8;
  if (args.changedFiles <= 3 && changedLines <= 80) score += 4;
  const clamped = Math.max(1, Math.min(100, Math.round(score)));
  return {
    score: clamped,
    label: clamped >= 85 ? "fast green" : clamped >= 65 ? "fast reviewable" : clamped >= 40 ? "fast work left" : "fast blocked",
    tone: clamped >= 85 ? "added" : clamped >= 65 ? "improvement" : clamped >= 40 ? "queue" : "danger"
  };
}

function isDocsPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.startsWith("docs/") || lower.startsWith("src/main/docs/") || lower.endsWith(".adoc") || lower.endsWith(".md") || lower.endsWith(".rst") || lower.endsWith(".txt");
}

function isTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes("/test/") || lower.includes("/tests/") || lower.endsWith("test.java") || lower.endsWith("test.kt") || lower.endsWith("spec.groovy") || lower.endsWith(".spec.ts") || lower.endsWith(".test.ts") || lower.endsWith(".spec.tsx") || lower.endsWith(".test.tsx");
}
