import type { PrStack, PrStackNode, PrStackSummary, PrStackSummaryMap, StackMergeMethod, StackMergePlan, StackMergeResponse, StackMergeStep } from "../shared/types.js";
import { prKey } from "./cache.js";
import { CommandError, runCommand } from "./command.js";
import { githubCliEnv } from "./githubHost.js";
import { missingGithubTokenMessage, readGithubToken } from "./keychain.js";

/**
 * Stacked pull requests.
 *
 * GitHub has no first-class "stack" object. A stack is simply a chain of open
 * PRs where PR B's base branch is PR A's head branch. MNLens reconstructs that
 * graph from one GraphQL query per repository (open PRs with base/head refs),
 * caches it briefly, and derives:
 *   - the chain root → leaf that contains a given PR,
 *   - its parent and children,
 *   - a compact summary map for queue badges.
 *
 * "Restack" reuses the existing branch-update preview (rebase/merge onto the
 * PR's *current base*), because for a stacked PR the base *is* the parent
 * branch. When a parent merges, GitHub retargets children to the parent's
 * base automatically if the branch is deleted; MNLens surfaces that the
 * parent is gone so the reviewer knows the diff scope changed.
 */

interface RawStackPr {
  number: number;
  title: string;
  url: string;
  author?: { login?: string } | null;
  baseRefName: string;
  headRefName: string;
  isDraft: boolean;
  state: string;
  mergeStateStatus?: string;
  reviewDecision?: string | null;
  isInMergeQueue?: boolean;
  mergeable?: string;
  headRepository?: { nameWithOwner?: string } | null;
}

export interface RepoStackGraph {
  repository: string;
  fetchedAt: number;
  byNumber: Map<number, PrStackNode>;
  byHead: Map<string, PrStackNode>;
}

const stackCacheTtlMs = Number(process.env.MNLENS_STACK_CACHE_TTL_MS ?? String(5 * 60_000));
const graphCache = new Map<string, RepoStackGraph>();
const inflight = new Map<string, Promise<RepoStackGraph>>();

const openPrsQuery = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        author { login }
        baseRefName
        headRefName
        isDraft
        state
        mergeStateStatus
        reviewDecision
        isInMergeQueue
        mergeable
        headRepository { nameWithOwner }
      }
    }
  }
}`;

export async function getPrStack(owner: string, repo: string, number: number, options: { force?: boolean } = {}): Promise<PrStack> {
  const graph = await loadRepoGraph(owner, repo, options.force);
  return buildStack(graph, number);
}

export async function getStackSummaries(repositories: string[], options: { force?: boolean } = {}): Promise<PrStackSummaryMap> {
  const unique = [...new Set(repositories.map((item) => item.trim()).filter((item) => /^[^/\s]+\/[^/\s]+$/.test(item)))].slice(0, 25);
  const summaries: PrStackSummaryMap = {};
  await Promise.all(
    unique.map(async (repository) => {
      const [owner, repo] = repository.split("/");
      const graph = await loadRepoGraph(owner, repo, options.force).catch(() => undefined);
      if (!graph) return;
      for (const node of graph.byNumber.values()) {
        const summary = summarize(graph, node.number);
        if (summary.size > 1) summaries[prKey(owner, repo, node.number)] = summary;
      }
    })
  );
  return summaries;
}

/** Drop cached graph(s) after a mutation that changes PR bases (retarget, merge, push). */
export function invalidateStackCache(repository?: string): void {
  if (!repository) {
    graphCache.clear();
    return;
  }
  graphCache.delete(repository);
}

export function buildStack(graph: RepoStackGraph, number: number): PrStack {
  const target = graph.byNumber.get(number);
  const fetchedAt = new Date(graph.fetchedAt).toISOString();
  if (!target) {
    return { repository: graph.repository, number, isStacked: false, chain: [], position: 0, children: [], trunk: "", fetchedAt };
  }
  const ancestors: PrStackNode[] = [];
  const seen = new Set<number>([number]);
  let cursor: PrStackNode | undefined = target;
  while (cursor?.parentNumber !== undefined) {
    const parent = graph.byNumber.get(cursor.parentNumber);
    if (!parent || seen.has(parent.number)) break;
    seen.add(parent.number);
    ancestors.unshift(parent);
    cursor = parent;
  }
  // Follow the "main line" of descendants: when a PR has several children, pick the most recently updated (first in graph order).
  const descendants: PrStackNode[] = [];
  cursor = target;
  while (cursor && cursor.childNumbers.length > 0) {
    const next: PrStackNode | undefined = cursor.childNumbers
      .map((child) => graph.byNumber.get(child))
      .find((node): node is PrStackNode => Boolean(node && !seen.has(node.number)));
    if (!next) break;
    seen.add(next.number);
    descendants.push(next);
    cursor = next;
  }
  const chain = [...ancestors, target, ...descendants];
  const root = chain[0];
  const parent = target.parentNumber !== undefined ? graph.byNumber.get(target.parentNumber) : undefined;
  const children = target.childNumbers.map((child) => graph.byNumber.get(child)).filter((node): node is PrStackNode => Boolean(node));
  return {
    repository: graph.repository,
    number,
    isStacked: Boolean(parent) || children.length > 0,
    chain,
    position: ancestors.length + 1,
    parent,
    children,
    trunk: root?.baseRefName ?? target.baseRefName,
    fetchedAt
  };
}

export function buildRepoGraph(repository: string, prs: RawStackPr[], fetchedAt = Date.now()): RepoStackGraph {
  const byNumber = new Map<number, PrStackNode>();
  const byHead = new Map<string, PrStackNode>();
  for (const raw of prs) {
    // Fork PRs cannot be stack parents inside this repository, so index only same-repo heads.
    const node: PrStackNode = {
      number: raw.number,
      title: raw.title ?? "",
      url: raw.url ?? "",
      author: raw.author?.login ?? "unknown",
      baseRefName: raw.baseRefName ?? "",
      headRefName: raw.headRefName ?? "",
      isDraft: Boolean(raw.isDraft),
      state: raw.state ?? "OPEN",
      mergeStateStatus: raw.mergeStateStatus ?? undefined,
      reviewDecision: raw.reviewDecision ?? undefined,
      isInMergeQueue: Boolean(raw.isInMergeQueue),
      mergeable: raw.mergeable ?? undefined,
      childNumbers: []
    };
    byNumber.set(node.number, node);
    const sameRepo = !raw.headRepository?.nameWithOwner || raw.headRepository.nameWithOwner.toLowerCase() === repository.toLowerCase();
    if (sameRepo && node.headRefName && !byHead.has(node.headRefName)) byHead.set(node.headRefName, node);
  }
  for (const node of byNumber.values()) {
    const parent = byHead.get(node.baseRefName);
    if (!parent || parent.number === node.number) continue;
    node.parentNumber = parent.number;
    parent.childNumbers.push(node.number);
  }
  for (const node of byNumber.values()) node.childNumbers.sort((a, b) => a - b);
  return { repository, fetchedAt, byNumber, byHead };
}

function summarize(graph: RepoStackGraph, number: number): PrStackSummary {
  const stack = buildStack(graph, number);
  return {
    size: stack.chain.length,
    position: stack.position,
    parentNumber: stack.parent?.number,
    childNumbers: stack.children.map((child) => child.number)
  };
}

async function loadRepoGraph(owner: string, repo: string, force = false): Promise<RepoStackGraph> {
  const repository = `${owner}/${repo}`;
  const cached = graphCache.get(repository);
  if (!force && cached && Date.now() - cached.fetchedAt < stackCacheTtlMs) return cached;
  const pending = inflight.get(repository);
  if (pending) return pending;
  const promise = fetchRepoGraph(owner, repo)
    .then((graph) => {
      graphCache.set(repository, graph);
      return graph;
    })
    .finally(() => inflight.delete(repository));
  inflight.set(repository, promise);
  return promise;
}

async function fetchRepoGraph(owner: string, repo: string): Promise<RepoStackGraph> {
  const token = await readGithubToken();
  if (!token) throw new Error(missingGithubTokenMessage());
  const prs: RawStackPr[] = [];
  let after: string | undefined;
  // Two pages (200 open PRs) is plenty for stack detection and keeps rate-limit cost bounded.
  for (let page = 0; page < 2; page += 1) {
    const args = ["api", "graphql", "-f", `query=${openPrsQuery}`, "-F", `owner=${owner}`, "-F", `name=${repo}`];
    if (after) args.push("-F", `after=${after}`);
    const result = await runCommand("gh", args, { env: githubCliEnv(token), redact: [token], timeoutMs: 60_000 });
    const payload = JSON.parse(result.stdout) as {
      data?: { repository?: { pullRequests?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string }; nodes?: RawStackPr[] } } };
    };
    const connection = payload.data?.repository?.pullRequests;
    prs.push(...(connection?.nodes ?? []));
    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
  }
  return buildRepoGraph(`${owner}/${repo}`, prs);
}

export function stackPromptContext(stack: PrStack | undefined): Record<string, unknown> | undefined {
  if (!stack?.isStacked) return undefined;
  return {
    note:
      "This PR is part of a stack. Its diff is relative to the PARENT PR's branch, not the trunk. Review only the incremental change; do not flag parent-PR code as missing or unexplained, and do not suggest retargeting to trunk unless the parent is merged.",
    position: `${stack.position} of ${stack.chain.length}`,
    trunk: stack.trunk,
    parent: stack.parent ? { number: stack.parent.number, title: stack.parent.title, url: stack.parent.url, headRefName: stack.parent.headRefName, reviewDecision: stack.parent.reviewDecision } : undefined,
    children: stack.children.map((child) => ({ number: child.number, title: child.title, url: child.url })),
    chain: stack.chain.map((node) => `#${node.number} ${node.title} (${node.headRefName} → ${node.baseRefName})`)
  };
}

// ---------------------------------------------------------------------------
// Stack merge plan and guarded bottom-up merge
// ---------------------------------------------------------------------------

/**
 * Bottom-up plan: the root merges first; each child becomes mergeable once its
 * parent is merged (GitHub retargets it to the trunk when the parent branch is
 * deleted) and it has been restacked. Readiness is judged from GitHub state
 * only — MNLens never merges without the reviewer clicking through.
 */
export function stackMergePlan(stack: PrStack): StackMergePlan {
  const steps: StackMergeStep[] = [];
  let parentPending = false;
  let nextNumber: number | undefined;
  for (const node of stack.chain) {
    const blockers: string[] = [];
    if (node.state !== "OPEN") blockers.push("not open");
    if (node.isDraft) blockers.push("draft");
    if (node.reviewDecision !== "APPROVED") blockers.push(node.reviewDecision === "CHANGES_REQUESTED" ? "changes requested" : "not approved");
    if (node.mergeable === "CONFLICTING" || node.mergeStateStatus === "DIRTY") blockers.push("merge conflicts");
    if (node.mergeStateStatus === "BLOCKED") blockers.push("blocked by branch protection or failing required checks");
    if (node.mergeStateStatus === "BEHIND") blockers.push("behind its base; restack first");
    if (node.isInMergeQueue) blockers.push("already in the merge queue");
    if (parentPending) blockers.push("parent PR must merge first");
    const ready = blockers.length === 0;
    if (ready && nextNumber === undefined) nextNumber = node.number;
    steps.push({ number: node.number, title: node.title, headRefName: node.headRefName, ready, blockers, isCurrent: node.number === stack.number, isNext: false });
    if (node.state === "OPEN") parentPending = true;
  }
  for (const step of steps) step.isNext = step.number === nextNumber;
  return { repository: stack.repository, trunk: stack.trunk, steps, nextNumber, mergeQueueActive: stack.chain.some((node) => node.isInMergeQueue) };
}

/**
 * Merges one PR of a stack after re-checking GitHub state. Only the lowest
 * mergeable PR (the one the plan marks `isNext`) is accepted, so a reviewer
 * cannot accidentally merge a child under an unmerged parent.
 */
export async function mergeStackStep(owner: string, repo: string, number: number, method: StackMergeMethod, deleteBranch = true): Promise<StackMergeResponse> {
  const stack = await getPrStack(owner, repo, number, { force: true });
  const plan = stackMergePlan(stack);
  const step = plan.steps.find((item) => item.number === number);
  if (!step) throw new Error(`PR #${number} is not part of an open stack in ${owner}/${repo}.`);
  if (!step.ready) throw new Error(`PR #${number} is not ready to merge: ${step.blockers.join(", ")}.`);
  if (plan.nextNumber !== number) throw new Error(`Merge the stack bottom-up: #${plan.nextNumber} must merge before #${number}.`);
  const token = await readGithubToken();
  if (!token) throw new Error(missingGithubTokenMessage());
  const args = ["pr", "merge", String(number), "-R", `${owner}/${repo}`, `--${method}`];
  if (deleteBranch) args.push("--delete-branch");
  try {
    await runCommand("gh", args, { env: githubCliEnv(token), redact: [token], timeoutMs: 120_000 });
  } catch (error) {
    if (error instanceof CommandError) throw new Error(`gh pr merge failed: ${error.result.stderr || error.result.stdout || error.message}`.trim());
    throw error;
  }
  invalidateStackCache(`${owner}/${repo}`);
  const children = stack.children.map((child) => child.number);
  return {
    owner,
    repo,
    number,
    merged: true,
    childrenToRestack: children,
    message:
      children.length > 0
        ? `Merged #${number} (${method}). ${deleteBranch ? `GitHub retargets ${children.map((child) => `#${child}`).join(", ")} to ${stack.trunk}; ` : ""}open the next PR and use Restack to preview rebasing it.`
        : `Merged #${number} (${method}). The stack is complete.`
  };
}
