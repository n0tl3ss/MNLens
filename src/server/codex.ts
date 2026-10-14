import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AnalysisResult, AnalysisType, CiCheck, PrDetail, PrStack, ReviewInsight } from "../shared/types.js";
import { agentDisplayName, agentScratchDir, codexSchemaPathFor, runAgent } from "./agent.js";
import { readAnalysis, writeAnalysis } from "./cache.js";
import { deltaAgainstPrevious } from "./analysisDelta.js";
import { budgetDiff } from "./diffBudget.js";
import { runCommand } from "./command.js";
import { githubCliEnv, hardenWorktreeCredentials } from "./githubHost.js";
import { readGithubToken } from "./keychain.js";
import { cacheDir } from "./paths.js";
import { getPrStack, stackPromptContext } from "./stacks.js";
import { analysisContextHash } from "../shared/analysisContext.js";
import { calibrationPromptBlock } from "./reviewMemory.js";
import { listRepoRules } from "./repoRules.js";

// Re-exported for modules that still import the Codex home from here.
export { codexHome, ensureCodexHome } from "./agent.js";

const maxDiffChars = 100_000;

const insightSchema = z.object({
  title: z.string().default(""),
  observation: z.string().default(""),
  perspective: z.string().default(""),
  recommendation: z.string().default(""),
  severity: z.enum(["info", "low", "medium", "high"]).default("medium")
});

const readingGuideStepSchema = z.object({
  path: z.string().default(""),
  lines: z.string().default(""),
  title: z.string().default(""),
  explanation: z.string().default(""),
  whyItMatters: z.string().default("")
});

const assumptionSchema = insightSchema.extend({
  location: z.string().default("")
});

const edgeCaseSchema = insightSchema.extend({
  location: z.string().default(""),
  covered: z.enum(["yes", "partial", "no", "unknown"]).catch("unknown")
});

const testAssessmentSchema = z.object({
  rating: z.enum(["unknown", "weak", "partial", "good", "strong"]).default("unknown"),
  summary: z.string().default(""),
  covered: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  recommendedTests: z.array(z.string()).default([])
});

const analysisSchema = z.object({
  type: z.enum(["feature", "bug", "improvement", "refactor", "docs", "test", "chore", "unknown"]),
  confidence: z.number().min(0).max(1).catch(0.5),
  summary: z.string().default(""),
  evidence: z.array(z.string()).default([]),
  evidenceDetails: z.array(insightSchema).default([]),
  behaviorBefore: z.string().default(""),
  behaviorAfter: z.string().default(""),
  reviewerFocus: z.array(z.string()).default([]),
  reviewerFocusDetails: z.array(insightSchema).default([]),
  risks: z.array(z.string()).default([]),
  riskDetails: z.array(insightSchema).default([]),
  testsToCheck: z.array(z.string()).default([]),
  testAssessment: testAssessmentSchema.default({
    rating: "unknown",
    summary: "",
    covered: [],
    gaps: [],
    recommendedTests: []
  }),
  caveats: z.array(z.string()).default([]),
  readingGuide: z.array(readingGuideStepSchema).default([]),
  assumptions: z.array(assumptionSchema).default([]),
  edgeCases: z.array(edgeCaseSchema).default([]),
  inspectedFiles: z.array(z.string()).default([]),
  draftComment: z.string().default(""),
  modelNote: z.string().default("")
});

type RawAnalysis = z.infer<typeof analysisSchema>;

export async function analyzePr(
  detail: PrDetail,
  force = false,
  hooks: {
    onStatus?: (message: string) => void;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  } = {}
): Promise<AnalysisResult> {
  const cached = await readAnalysis(detail.key);
  const contextHash = analysisContextHash(detail);
  if (!force && cached?.diffHash === detail.diffHash && (!cached.contextHash || cached.contextHash === contextHash)) {
    hooks.onStatus?.("Using cached analysis for the current PR diff and discussion state.");
    return cached;
  }
  if (!force && cached?.diffHash === detail.diffHash) {
    hooks.onStatus?.("Comments, reviews or linked issues changed since the cached analysis; refreshing it.");
  }

  hooks.onStatus?.("Preparing analysis schema and local agent session state.");
  const outputPath = join(cacheDir, "agent-output", `${detail.key}-${Date.now()}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  const schema = analysisJsonSchema();
  await writeFile(codexSchemaPathFor(outputPath), JSON.stringify(schema, null, 2));

  hooks.onStatus?.("Checking whether this PR is part of a stack.");
  const stack = await getPrStack(detail.owner, detail.repo, detail.number).catch((): PrStack | undefined => undefined);

  const calibration = await calibrationPromptBlock(detail.repository).catch(() => "");
  const repoRules = (await listRepoRules(detail.repository).catch(() => [])).filter((rule) => rule.enabled);
  const reviewerIsAuthor = await reviewerIsPrAuthor(detail);
  hooks.onStatus?.("Preparing a read-only checkout of the PR so the agent can read surrounding code.");
  // Same shallow clone the acceptance contract uses. Without it the agent only sees the diff and has to guess
  // about callers, defaults and existing tests, which is where a standalone `claude` session in the repo beats it.
  const repoDir = await ensureAnalysisWorktree(detail).catch(() => undefined);
  const repoGuidance = await readRepoGuidance(repoDir);
  const prompt = buildPrompt(detail, stack, { calibration, repoRules: repoRules.map((rule) => `${rule.title}: ${rule.body}`), reviewerIsAuthor, hasCheckout: Boolean(repoDir), repoGuidance });
  hooks.onStatus?.(repoDir ? "Running agent analysis inside the PR checkout with diff, comments, linked issues, CI, stack context, and local review policy context." : "Running agent analysis with PR diff, comments, linked issues, CI, stack context, and local review policy context (no checkout available).");
  const { invocation, result, output } = await runAgent(
    {
      task: "deep-analysis",
      prKey: detail.key,
      prompt,
      access: "read-only",
      cwd: repoDir ?? (await agentScratchDir()),
      webSearch: true,
      outputSchema: schema,
      outputLastMessagePath: outputPath
    },
    { timeoutMs: 10 * 60_000, onStdout: hooks.onStdout, onStderr: hooks.onStderr }
  );
  if (output.isError) throw new Error(output.text || `${invocation.label} reported an error without a message.`);

  hooks.onStatus?.(`Parsing and normalizing ${agentDisplayName(invocation.agent)} review guidance.`);
  const parsed =
    output.structured && typeof output.structured === "object"
      ? analysisSchema.parse(output.structured)
      : parseCodexOutput(invocation.agent === "codex" ? await readOutput(outputPath, result.stdout) : output.text);
  const normalized = await normalizeAnalysisWithLocalGradleChecks(detail, normalizeAnalysisForDetail(detail, parsed));
  const analysis: AnalysisResult = {
    prKey: detail.key,
    diffHash: detail.diffHash,
    contextHash,
    ...normalized,
    generatedAt: new Date().toISOString(),
    agent: invocation.agent,
    model: invocation.model,
    costUsd: output.costUsd,
    stack: stack?.isStacked
      ? { parentNumber: stack.parent?.number, parentTitle: stack.parent?.title, position: stack.position, size: stack.chain.length }
      : undefined
  };
  // Compared with the last analysis of a different diff, so the reviewer sees what the new commits resolved.
  const delta = await deltaAgainstPrevious(detail, cached, analysis).catch(() => undefined);
  if (delta) {
    analysis.delta = delta;
    hooks.onStatus?.(
      `Compared with the previous analysis: ${delta.resolved.length} resolved, ${delta.added.length} new, ${delta.persisting.length} persisting${delta.carriedVerdicts ? `, ${delta.carriedVerdicts} verdict(s) carried over` : ""}.`
    );
  }
  await writeAnalysis(analysis);
  hooks.onStatus?.("Analysis complete.");
  return analysis;
}

export async function askRisk(detail: PrDetail, risk: ReviewInsight | { observation: string }, question: string): Promise<string> {
  const { invocation, output } = await runAgent(
    { task: "quick-answer", prKey: detail.key, prompt: buildRiskQuestionPrompt(detail, risk, question), access: "read-only", cwd: await agentScratchDir(), webSearch: true },
    { timeoutMs: 5 * 60_000 }
  );
  return output.text || `${agentDisplayName(invocation.agent)} did not return an answer.`;
}

export async function askCiFailure(detail: PrDetail, check: CiCheck, log = ""): Promise<string> {
  const { invocation, output } = await runAgent(
    { task: "ci-explain", prKey: detail.key, prompt: buildCiFailurePrompt(detail, check, log), access: "read-only", cwd: await agentScratchDir() },
    { timeoutMs: 5 * 60_000 }
  );
  return output.text || `${agentDisplayName(invocation.agent)} did not return an answer.`;
}

const repoGuidanceFiles = ["CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md", "CONTRIBUTING.md", ".github/CONTRIBUTING.md", ".github/PULL_REQUEST_TEMPLATE.md", "MAINTAINING.md", ".cursorrules"];

export interface RepoGuidance {
  path: string;
  excerpt: string;
}

/**
 * The repository's own guidance for contributors and coding agents (CLAUDE.md,
 * AGENTS.md, Copilot instructions, CONTRIBUTING, PR template). Fed to the
 * analysis and review-draft prompts so the agent judges the PR against the
 * maintainers' conventions and test commands instead of generic ones.
 */
export async function readRepoGuidance(repoDir: string | undefined, limits = { perFile: 2500, total: 7000 }): Promise<RepoGuidance[]> {
  if (!repoDir) return [];
  const candidates = [...repoGuidanceFiles];
  try {
    const instructions = (await readdir(join(repoDir, ".github", "instructions"))).filter((name) => name.endsWith(".md")).sort().slice(0, 4);
    candidates.push(...instructions.map((name) => `.github/instructions/${name}`));
  } catch {
    // No Copilot instructions directory.
  }
  const guidance: RepoGuidance[] = [];
  let total = 0;
  for (const relative of candidates) {
    let text: string;
    try {
      text = (await readFile(join(repoDir, relative), "utf8")).trim();
    } catch {
      continue;
    }
    if (!text) continue;
    const excerpt = text.length > limits.perFile ? `${text.slice(0, limits.perFile)}\n[truncated]` : text;
    if (total + excerpt.length > limits.total) break;
    total += excerpt.length;
    guidance.push({ path: relative, excerpt });
  }
  return guidance;
}

export function repoGuidancePromptBlock(guidance: RepoGuidance[] | undefined): string {
  if (!guidance || guidance.length === 0) return "";
  return `\nRepository guidance written by the maintainers for contributors and coding agents. Judge the PR against these conventions, cite the file when the PR deviates from them, and prefer the commands they name in testsToCheck:\n${guidance.map((item) => `--- ${item.path} ---\n${item.excerpt}`).join("\n\n")}\n`;
}

/** True when the signed-in reviewer wrote the PR (self-review of agent-generated code). Best-effort; never blocks analysis. */
async function reviewerIsPrAuthor(detail: PrDetail): Promise<boolean> {
  try {
    // Dynamic import: gh.ts imports this module for list normalization, so a static import would be circular.
    const { currentUsername } = await import("./gh.js");
    const username = await currentUsername();
    return Boolean(username && detail.author && username.toLowerCase() === detail.author.toLowerCase());
  } catch {
    return false;
  }
}

export function buildPrompt(
  detail: PrDetail,
  stack?: PrStack,
  context: { calibration?: string; repoRules?: string[]; reviewerIsAuthor?: boolean; hasCheckout?: boolean; repoGuidance?: RepoGuidance[] } = {}
): string {
  const { text: diff } = budgetDiff(detail.diff, maxDiffChars, { hasCheckout: context.hasCheckout });
  const payload = {
    pr: {
      repository: detail.repository,
      number: detail.number,
      title: detail.title,
      body: detail.body,
      linkedIssues: detail.linkedIssues ?? [],
      author: detail.author,
      labels: detail.labels,
      url: detail.url,
      baseRefName: detail.baseRefName,
      headRefName: detail.headRefName,
      additions: detail.additions,
      deletions: detail.deletions,
      changedFiles: detail.changedFiles,
      reviewDecision: detail.reviewDecision,
      mergeStateStatus: detail.mergeStateStatus,
      files: detail.files
    },
    diff,
    stack: stackPromptContext(stack)
  };

  const selfReview = context.reviewerIsAuthor
    ? `
The reviewer is the PR author, reviewing code that was largely written by an AI agent before asking colleagues for review. Be adversarial on their behalf: treat nothing in the PR body as proven, prioritize assumptions, defaults and edge cases the agent may have invented, and write draftComment as self-review notes for the author (what to fix or double-check before requesting review) rather than as a message to someone else.
`
    : "";
  const checkout = context.hasCheckout
    ? `
You are working inside a read-only checkout of the PR at its head commit. Do not judge from the diff alone. Open files with the Read tool and search with Grep or Glob; Bash is limited to read-only git (log, show, diff, blame, grep), rg and grep, so cat, ls, find and build commands are denied. A denied command is not a reason to stop inspecting: use Read and Grep instead. Before writing the JSON, do all of the following and cite what you read as path:line:
1. Open every changed production (non-test) file around each hunk so you see the surrounding control flow, defaults and error handling, not just the changed lines.
2. For each changed or newly introduced symbol (method, class, constant, configuration key), grep the repository for its callers and usages, and read the ones that decide how the change behaves: where defaults are set, where state is persisted or versioned, where errors are handled, where the symbol is wired in.
3. Find the tests that exercise the changed symbols (grep for their names) and check what they actually assert.
List every file you opened beyond the diff in inspectedFiles (repository-relative paths). For a change to production code an empty inspectedFiles is not acceptable. Stay targeted: read the files that decide behavior, not whole directories.
`
    : "";
  return `You are helping a human review a GitHub pull request made by an agent.${selfReview}${checkout}

Classify the PR as exactly one of: feature, bug, improvement, refactor, docs, test, chore, unknown.

Return only JSON that matches the provided schema. Do not wrap it in Markdown.

Behavior rules:
- If a \`stack\` object is present, the PR is stacked on a parent PR: judge only the incremental diff against the parent branch, mention the parent PR number in the summary, and treat "depends on parent being correct" as a caveat rather than a risk.
- Treat the PR body and linked issues as primary intent evidence. If linked issues exist, compare the PR against the issue request/bug report before judging completeness, risks, tests, and review comments.
- For bug PRs, explain previous behavior and new behavior when inferable.
- For feature PRs, check the authoritative documentation of the APIs the change relies on only when a finding depends on it, and cite the URL in that finding. Do not collect reference links for their own sake. Call out caveats and edge cases.
- For improvement PRs, explain what changed, why it helps, and tradeoffs.
- For every PR, produce concrete reviewer focus areas, risks, tests to check, and a draft review comment.
- Scale the amount of analysis to the source-code change, not the total PR size. If most changes are tests/docs and production/source code is tiny, keep reviewerFocus, risks, caveats, and draftComment short. Do not make the human read more AI text than the source change warrants.
- Put test edge-case coverage at the center of the review. Explicitly compare changed production/source behavior against tests: which behavior paths are covered, which edge cases are missing, and whether the tests would fail before the PR.
- For docs-only, test-only, or very small bug/improvement PRs, prefer 1-3 high-signal reviewer focus items and 0-2 risks unless there is a real blocker.
- Reviewer focus and risks should include judgment, not just neutral observations. Say whether the implementation looks right, should be done differently, is missing an edge case, or needs proof. Prefer reviewer-useful phrases like "My take: this is probably correct if...", "This should be improved because...", "Missing edge case:", or "I would not approve until...".
- For every evidence item, also add a matching evidenceDetails item with title, observation, perspective, recommendation, and severity. Evidence perspective should explain what the fact means for review confidence, not just restate the fact.
- For every reviewerFocus item, also add a matching reviewerFocusDetails item with title, observation, perspective, recommendation, and severity.
- For every risk item, also add a matching riskDetails item with title, observation, perspective, recommendation, and severity.
- Add testAssessment that rates how well this PR is tested. Be direct: strong/good only when changed production behavior, regression paths, and important edge cases are covered; partial/weak when tests are mostly bean-presence, snapshots, happy path, or docs-only. For each gap, connect it to a concrete changed source behavior or edge case.
- For testsToCheck, keep manual work to the minimum. Prefer runnable commands, existing CI checks, or a concrete automated-test/TCK suggestion over manual verification.
- For Gradle multi-project builds, do not guess project paths. Before proposing a module-scoped command, verify the project path from \`settings.gradle\`, \`settings.gradle.kts\`, or \`./gradlew projects\`. Prefer the exact included project name that owns the changed file path, and quote wildcard \`--tests\` patterns.
- For docs-only PRs, testsToCheck should focus on documentation correctness: build/render the docs, inspect the changed page/section, and capture screenshot or rendered HTML evidence when possible. Do not suggest generic commands like \`git diff --check\` unless the PR specifically changes whitespace, line endings, or formatting rules.
- If an integration behavior is important but not currently covered, write it as an automatable item such as "Add/run automated test: ..." or "Add/run TCK coverage: ...", with the behavior and pass/fail assertion. Do not turn it into manual work just because no command exists yet.
- Only write "Manual verification:" items when automation is not realistic, such as requiring real cloud resources, external credentials/accounts, paid services, release permissions, visual/UX judgment, or infrastructure that cannot be provisioned locally. Manual items must include pass/fail criteria.
- Look deliberately for these pitfalls, which structured reviews tend to skip: (a) logic duplicated from an existing path (a fast path, a fallback, a copy of a switch) that can drift from the original; (b) a cheap guard placed after expensive work it could have skipped (ordering of checks, work done before an early return); (c) behavior changes hidden inside an "optimization" (a scope, a conversion, a callback or side effect that is no longer executed); (d) conversions or wrappers the new path skips (type adaptation, null handling, error mapping) that the old path still performs; (e) version or state compatibility (persisted formats, cache keys, STATE_VERSION-style markers) left unchanged while recorded data changed; (f) caller assumptions about ordering, threading or identity (the same instance returned, no extra wrapping). Report each as a risk, assumption or edge case with its location.
- readingGuide: the order a human should read this diff to understand it fastest. 3-8 steps for a typical PR, 1-2 for a tiny one. Start from the entry point or the behavior change, not from file order. Each step: path (must be a file in the diff), lines (a "start-end" range in the new file, or "" for the whole file), a short title, a plain-language explanation of what that code does, and whyItMatters for the review.
- assumptions: every default value, default behavior, implicit contract or environmental assumption this PR introduces or relies on: configuration defaults, null/empty handling, ordering, timeouts and limits, encodings, feature flags, "callers always pass X", threading, compatibility with existing data or older versions. For each: title; observation = the assumption and where it lives; perspective = what breaks or who is affected if it is wrong; recommendation = the fastest way for the reviewer to verify it (a test to read, a call site to grep, a question for the author); location = "path:line" in the diff; severity by blast radius. Leave the array empty rather than inventing assumptions.
- edgeCases: boundary, empty/null, error-path, concurrency, ordering, compatibility and resource scenarios the changed code can actually hit. For each: title; observation = the scenario and the code path involved; perspective = the expected behavior and what the current code appears to do; recommendation = how to check it (an existing test name, a test to add, a command); location = "path:line"; covered = "yes" when an existing test exercises it, "partial", "no", or "unknown". Uncovered high-severity edge cases must also appear in testAssessment.gaps.
- Be explicit when evidence is missing. Do not invent docs or source links.
- Prefer concise, review-useful language over broad summaries.
${context.repoRules && context.repoRules.length > 0 ? `\nRepository review rules set by the maintainers (follow them):\n${context.repoRules.map((rule) => `- ${rule}`).join("\n")}\n` : ""}${context.calibration ? `\n${context.calibration}\n` : ""}${repoGuidancePromptBlock(context.repoGuidance)}
PR packet:
${JSON.stringify(payload, null, 2)}
`;
}

function buildRiskQuestionPrompt(detail: PrDetail, risk: ReviewInsight | { observation: string }, question: string): string {
  const observation = risk.observation ?? "";
  const mentionedPaths = pathsMentionedInText(observation, detail.files.map((file) => file.path));
  const diff = focusedDiff(detail.diff, mentionedPaths, 35_000);
  const payload = {
    pr: {
      repository: detail.repository,
      number: detail.number,
      title: detail.title,
      body: truncateText(detail.body, 5000),
      linkedIssues: (detail.linkedIssues ?? []).slice(0, 3).map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        url: issue.url,
        body: truncateText(issue.body, 3000)
      })),
      author: detail.author,
      labels: detail.labels,
      baseRefName: detail.baseRefName,
      headRefName: detail.headRefName,
      additions: detail.additions,
      deletions: detail.deletions,
      changedFiles: detail.changedFiles,
      reviewDecision: detail.reviewDecision,
      mergeStateStatus: detail.mergeStateStatus,
      files: detail.files,
      relevantFiles: mentionedPaths.length > 0 ? detail.files.filter((file) => mentionedPaths.includes(file.path)) : [],
      commits: detail.commits.slice(-12).map((commit) => ({
        shortSha: commit.shortSha,
        message: commit.message,
        author: commit.author,
        committedAt: commit.committedAt,
        files: commit.files.filter((file) => mentionedPaths.includes(file.path)).slice(0, 20)
      }))
    },
    risk,
    mentionedPaths,
    diff
  };

  return `You are helping a human reviewer investigate one review point in a GitHub PR. The review point may be a risk, reviewer-focus item, evidence item, CI failure, or follow-up question.

Answer the reviewer's question with concise, actionable detail. Mention what evidence in the diff supports the answer, what remains uncertain, and what the reviewer should check next. If the question asks whether the point is resolved, be direct.

Do not make code changes. Do not submit a review. Do not invent facts.

Reviewer question:
${question.trim()}

PR review-point context:
${JSON.stringify(payload, null, 2)}
`;
}

function pathsMentionedInText(text: string, knownPaths: string[]): string[] {
  const normalized = text.replace(/[`'"]/g, "");
  const matches = knownPaths.filter((path) => {
    const fileName = path.split("/").pop() ?? path;
    return normalized.includes(path) || (fileName.length > 0 && normalized.includes(fileName));
  });
  return [...new Set(matches)].slice(0, 8);
}

function focusedDiff(diff: string, paths: string[], maxChars: number): string {
  const sections = paths.length > 0 ? diffSectionsForPaths(diff, paths) : [];
  const source = sections.length > 0 ? sections.join("\n") : diff;
  if (source.length <= maxChars) return source;
  return `${source.slice(0, maxChars)}\n\n[Focused diff truncated from ${source.length} characters.]`;
}

function diffSectionsForPaths(diff: string, paths: string[]): string[] {
  const wanted = new Set(paths);
  const sections: string[] = [];
  let current: string[] = [];
  let currentPath = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current.length > 0 && wanted.has(currentPath)) sections.push(current.join("\n"));
      current = [line];
      currentPath = diffHeaderPath(line);
      continue;
    }
    current.push(line);
    if (line.startsWith("+++ ")) {
      currentPath = normalizeDiffPath(line.slice(4)) || currentPath;
    }
  }
  if (current.length > 0 && wanted.has(currentPath)) sections.push(current.join("\n"));
  return sections;
}

function diffHeaderPath(line: string): string {
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
  return match?.[2] ?? "";
}

function normalizeDiffPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") return "";
  return trimmed.replace(/^[ab]\//, "");
}

function truncateText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n\n[Text truncated from ${value.length} characters.]` : value;
}

function buildCiFailurePrompt(detail: PrDetail, check: CiCheck, log: string): string {
  const trimmedLog = log.length > 45_000 ? `${log.slice(-45_000)}\n\n[CI log truncated to the last 45000 characters.]` : log;
  const vulnerabilityGuidance = isVulnerabilityAuditCheck(check)
    ? `\nSpecial handling for Vulnerability Audit failures:\n- These usually mean a third-party dependency needs to be updated.\n- Explain the vulnerable artifact and the likely dependency path/root dependency that brings it in.\n- Prefer updating the root dependency/BOM/platform that owns the vulnerable transitive dependency. Example: if a Netty CVE comes through Micronaut Core, first consider updating Micronaut Core or the Micronaut platform version.\n- Treat adding a direct fixed transitive version or dependency constraint as a last resort, and say what evidence would justify it.\n`
    : "";
  return `You are helping a human reviewer understand a failing GitHub CI check on a pull request.

Explain the likely failure in concise reviewer language:
- What failed.
- The most relevant error lines or symptoms.
- Whether this looks caused by the PR, environment/flakiness, or unknown.
- What the reviewer should do next.
- If appropriate, suggest a focused fix-session instruction.

Do not invent log lines. If no log is provided, say that the exact cause needs logs and reason only from the check metadata.
${vulnerabilityGuidance}

PR:
${JSON.stringify(
  {
    repository: detail.repository,
    number: detail.number,
    title: detail.title,
    baseRefName: detail.baseRefName,
    headRefName: detail.headRefName,
    files: detail.files
  },
  null,
  2
)}

CI check:
${JSON.stringify(check, null, 2)}

CI log:
${trimmedLog || "[No CI log fetched yet.]"}
`;
}

function isVulnerabilityAuditCheck(check: CiCheck): boolean {
  const text = `${check.name} ${check.workflow} ${check.description}`.toLowerCase();
  return text.includes("vulnerab") || text.includes("cve") || text.includes("audit");
}

export function analysisJsonSchema(): Record<string, unknown> {
  return {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "confidence",
          "summary",
          "evidence",
          "evidenceDetails",
          "behaviorBefore",
          "behaviorAfter",
          "reviewerFocus",
          "reviewerFocusDetails",
          "risks",
          "riskDetails",
          "testsToCheck",
          "testAssessment",
          "caveats",
          "readingGuide",
          "assumptions",
          "edgeCases",
          "inspectedFiles",
          "draftComment",
          "modelNote"
        ],
        properties: {
          type: {
            type: "string",
            enum: ["feature", "bug", "improvement", "refactor", "docs", "test", "chore", "unknown"]
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          summary: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          evidenceDetails: { type: "array", items: insightJsonSchema() },
          behaviorBefore: { type: "string" },
          behaviorAfter: { type: "string" },
          reviewerFocus: { type: "array", items: { type: "string" } },
          reviewerFocusDetails: { type: "array", items: insightJsonSchema() },
          risks: { type: "array", items: { type: "string" } },
          riskDetails: { type: "array", items: insightJsonSchema() },
          testsToCheck: { type: "array", items: { type: "string" } },
          testAssessment: testAssessmentJsonSchema(),
          caveats: { type: "array", items: { type: "string" } },
          readingGuide: { type: "array", items: readingGuideStepJsonSchema() },
          assumptions: { type: "array", items: insightJsonSchema({ location: true }) },
          edgeCases: { type: "array", items: insightJsonSchema({ location: true, covered: true }) },
          inspectedFiles: { type: "array", items: { type: "string" } },
          draftComment: { type: "string" },
          modelNote: { type: "string" }
        }
  };
}

function readingGuideStepJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["path", "lines", "title", "explanation", "whyItMatters"],
    properties: {
      path: { type: "string" },
      lines: { type: "string" },
      title: { type: "string" },
      explanation: { type: "string" },
      whyItMatters: { type: "string" }
    }
  };
}

function insightJsonSchema(extra: { location?: boolean; covered?: boolean } = {}) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "observation", "perspective", "recommendation", "severity", ...(extra.location ? ["location"] : []), ...(extra.covered ? ["covered"] : [])],
    properties: {
      title: { type: "string" },
      observation: { type: "string" },
      perspective: { type: "string" },
      recommendation: { type: "string" },
      severity: { type: "string", enum: ["info", "low", "medium", "high"] },
      ...(extra.location ? { location: { type: "string" } } : {}),
      ...(extra.covered ? { covered: { type: "string", enum: ["yes", "partial", "no", "unknown"] } } : {})
    }
  };
}

function testAssessmentJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["rating", "summary", "covered", "gaps", "recommendedTests"],
    properties: {
      rating: { type: "string", enum: ["unknown", "weak", "partial", "good", "strong"] },
      summary: { type: "string" },
      covered: { type: "array", items: { type: "string" } },
      gaps: { type: "array", items: { type: "string" } },
      recommendedTests: { type: "array", items: { type: "string" } }
    }
  };
}

async function readOutput(path: string, stdout: string): Promise<string> {
  try {
    const file = await readFile(path, "utf8");
    if (file.trim()) return file;
  } catch {
    // Codex may still print the final message to stdout if the output file was not created.
  }
  return stdout;
}

export function parseCodexOutput(text: string): RawAnalysis {
  const json = extractJson(text);
  return analysisSchema.parse(JSON.parse(json));
}

export function normalizeAnalysisForDetail<T extends RawAnalysis | AnalysisResult>(detail: PrDetail, analysis: T): T {
  const docsOnly = isDocsOnlyDetail(detail);
  const docsOriented = docsOnly || analysis.type === "docs" || detail.files.some((file) => isDocsPath(file.path));
  if (!docsOriented) return analysis;

  const docsRenderItem = docsRenderVerificationItem(detail);
  const meaningfulItems = analysis.testsToCheck.filter((item) => !isGenericDiffCheck(item));
  const hasDocRenderItem = meaningfulItems.some((item) => isDocRenderCheck(item));
  const testsToCheck = hasDocRenderItem ? meaningfulItems : [docsRenderItem, ...meaningfulItems];
  const testAssessment = analysis.testAssessment ?? {
    rating: "unknown",
    summary: "",
    covered: [],
    gaps: [],
    recommendedTests: []
  };

  return {
    ...analysis,
    type: docsOnly ? "docs" : analysis.type,
    testsToCheck: docsOnly ? dedupeText(testsToCheck).slice(0, 3) : dedupeText(testsToCheck),
    testAssessment: docsOnly ? normalizeDocsTestAssessment(testAssessment) : normalizeDocsTestAssessmentReferences(testAssessment),
    caveats: analysis.caveats.map((item) => replaceGenericDiffCheckReference(item))
  };
}

export async function normalizeAnalysisWithLocalGradleChecks<T extends RawAnalysis | AnalysisResult>(detail: PrDetail, analysis: T): Promise<T> {
  if (!analysis.testsToCheck.some((item) => hasGradleProjectTask(item))) return analysis;
  const repoDir = await ensureAnalysisWorktree(detail).catch(() => undefined);
  if (!repoDir) return analysis;
  const gradleCommand = existsSync(join(repoDir, "gradlew")) ? "./gradlew" : "gradle";
  const projects = await discoverActualGradleProjects(repoDir, gradleCommand).catch(() => new Set<string>());
  if (projects.size === 0) return analysis;
  const rewrite = (item: string) => rewriteGradleProjectPathsInText(item, projects);
  const testAssessment = analysis.testAssessment ?? {
    rating: "unknown" as const,
    summary: "",
    covered: [],
    gaps: [],
    recommendedTests: []
  };
  const testsToCheck = analysis.testsToCheck.map(rewrite);
  const recommendedTests = testAssessment.recommendedTests.map(rewrite);
  const draftComment = rewrite(analysis.draftComment);
  if (
    testsToCheck.every((item, index) => item === analysis.testsToCheck[index]) &&
    recommendedTests.every((item, index) => item === testAssessment.recommendedTests[index]) &&
    draftComment === analysis.draftComment
  ) {
    return analysis;
  }
  return {
    ...analysis,
    testsToCheck: dedupeText(testsToCheck),
    testAssessment: {
      ...testAssessment,
      recommendedTests: dedupeText(recommendedTests)
    },
    draftComment
  };
}

const worktreeLocks = new Map<string, Promise<unknown>>();

/** Serializes git operations per directory so a Deep Analyze and an acceptance run on the same PR never race on index.lock. */
async function withWorktreeLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = worktreeLocks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  worktreeLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (worktreeLocks.get(key) === next) worktreeLocks.delete(key);
  }
}

/**
 * Read-only checkout of the PR head for analysis and the acceptance contract.
 *
 * One shallow clone per repository (`_repos/<owner>__<repo>`) holds the objects;
 * each PR gets a `git worktree` off it, so analyzing twenty PRs of one
 * repository costs one clone plus twenty single-commit fetches instead of
 * twenty clones. Checkouts made before this layout (a full clone per PR) keep
 * working through the legacy branch below.
 */
export async function ensureAnalysisWorktree(detail: PrDetail): Promise<string> {
  const token = await readGithubToken();
  if (!token) throw new Error("GitHub token is required to prepare a PR checkout for Gradle project validation.");
  const root = join(cacheDir, "analysis-worktrees");
  const repoDir = join(root, detail.key);
  await mkdir(root, { recursive: true });
  const gitEnv = githubCliEnv(token);
  const legacyClone = existsSync(join(repoDir, ".git")) && statSync(join(repoDir, ".git")).isDirectory();
  if (!legacyClone) {
    const baseDir = join(root, "_repos", `${detail.owner}__${detail.repo}`);
    const pullRef = `refs/mnlens/pull/${detail.number}`;
    return withWorktreeLock(baseDir, async () => {
      if (!existsSync(join(baseDir, ".git"))) {
        await rm(baseDir, { recursive: true, force: true });
        await mkdir(dirname(baseDir), { recursive: true });
        await runCommand("gh", ["repo", "clone", detail.repository, baseDir, "--", "--depth", "1"], { env: gitEnv, timeoutMs: 10 * 60_000, redact: [token] });
        await hardenWorktreeCredentials(baseDir);
        await runCommand("git", ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], { cwd: baseDir, timeoutMs: 30_000 }).catch(() => undefined);
      }
      // Fetch just the PR head commit; works for merged and fork PRs where `gh pr checkout` cannot find the branch.
      await runCommand("git", ["fetch", "--depth", "1", "origin", `+refs/pull/${detail.number}/head:${pullRef}`], { cwd: baseDir, env: gitEnv, timeoutMs: 5 * 60_000, redact: [token] });
      await runCommand("git", ["worktree", "prune"], { cwd: baseDir, timeoutMs: 30_000 }).catch(() => undefined);
      if (existsSync(join(repoDir, ".git"))) {
        await runCommand("git", ["checkout", "--detach", pullRef], { cwd: repoDir, env: gitEnv, timeoutMs: 60_000, redact: [token] });
      } else {
        await rm(repoDir, { recursive: true, force: true });
        await runCommand("git", ["worktree", "add", "--detach", repoDir, pullRef], { cwd: baseDir, env: gitEnv, timeoutMs: 60_000, redact: [token] });
      }
      return repoDir;
    });
  }
  return withWorktreeLock(repoDir, async () => {
  if (!existsSync(join(repoDir, ".git"))) {
    await rm(repoDir, { recursive: true, force: true });
    await runCommand("gh", ["repo", "clone", detail.repository, repoDir, "--", "--depth", "1"], {
      env: githubCliEnv(token),
      timeoutMs: 10 * 60_000,
      redact: [token]
    });
    await hardenWorktreeCredentials(repoDir);
  }
  // Legacy full clone per PR: restore the refspec (--depth implies --single-branch) and fetch the PR head directly.
  await runCommand("git", ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], { cwd: repoDir, timeoutMs: 30_000 }).catch(() => undefined);
  try {
    await runCommand("git", ["fetch", "--depth", "1", "origin", `+refs/pull/${detail.number}/head`], { cwd: repoDir, env: gitEnv, timeoutMs: 5 * 60_000, redact: [token] });
    await runCommand("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: repoDir, env: gitEnv, timeoutMs: 60_000, redact: [token] });
  } catch {
    await runCommand("gh", ["pr", "checkout", String(detail.number), "--detach"], {
      cwd: repoDir,
      env: gitEnv,
      timeoutMs: 5 * 60_000,
      redact: [token]
    });
  }
  return repoDir;
  });
}

async function discoverActualGradleProjects(repoDir: string, gradleCommand: string): Promise<Set<string>> {
  const result = await runCommand(gradleCommand, ["projects", "--quiet"], {
    cwd: repoDir,
    timeoutMs: 3 * 60_000
  });
  const projects = new Set<string>();
  for (const match of result.stdout.matchAll(/Project '(:[^']+)'/g)) projects.add(match[1]);
  return projects;
}

function hasGradleProjectTask(item: string): boolean {
  return /(?:^|[\s`])(?:\.\/gradlew|gradle)\b/.test(item) && /:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*:[A-Za-z][A-Za-z0-9_-]*/.test(item);
}

export function rewriteGradleProjectPathsInText(item: string, projects: Set<string>): string {
  if (!hasGradleProjectTask(item)) return item;
  const replacements = new Map<string, string>();
  const next = item.replace(/(:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*):([A-Za-z][A-Za-z0-9_-]*)/g, (full, projectPath: string, taskName: string) => {
    if (projects.has(projectPath)) return full;
    const replacement = closestGradleProject(projectPath, projects);
    if (!replacement) return full;
    replacements.set(projectPath, replacement);
    return `${replacement}:${taskName}`;
  });
  if (replacements.size === 0) return next;
  let corrected = next;
  for (const [from, to] of replacements) {
    corrected = corrected
      .replace(new RegExp(`The\\s+\`?${escapeRegExp(from)}\`?\\s+project path is present in\\s+\`?settings\\.gradle(?:\\.kts)?\`?\\.?`, "gi"), `MNLens verified the runnable Gradle project path as \`${to}\` via \`./gradlew projects\`.`)
      .replace(new RegExp(`project path\\s+\`?${escapeRegExp(from)}\`?`, "gi"), `project path \`${to}\``);
  }
  if (!/MNLens verified the runnable Gradle project path/.test(corrected)) {
    const unique = [...new Set(replacements.values())];
    corrected = `${corrected.replace(/\s+$/, "")} MNLens verified the runnable Gradle project path${unique.length > 1 ? "s" : ""}: ${unique.map((project) => `\`${project}\``).join(", ")}.`;
  }
  return corrected;
}

function closestGradleProject(requestedProject: string, projects: Set<string>): string | undefined {
  const requestedLeaf = requestedProject.split(":").filter(Boolean).at(-1) ?? requestedProject;
  const requestedNorm = normalizeGradleProjectName(requestedLeaf);
  const candidates = [...projects];
  const leafOf = (project: string) => project.split(":").filter(Boolean).at(-1) ?? project;
  return (
    candidates.find((project) => project.endsWith(`:${requestedLeaf}`)) ??
    candidates.find((project) => normalizeGradleProjectName(leafOf(project)) === requestedNorm) ??
    // Many multi-project builds prefix every module with the product name (`micronaut-core`, `spring-boot-actuator`).
    // Only the *candidate* side drops its leading word, so `:data-jdbc` never collapses onto an unrelated `:jdbc`.
    candidates.find((project) => stripLeadingWord(normalizeGradleProjectName(leafOf(project), false)) === requestedNorm) ??
    candidates.find((project) => normalizeGradleProjectName(project).endsWith(requestedNorm))
  );
}

function stripLeadingWord(value: string): string {
  return value.replace(/^[a-z][a-z0-9]*[-_](?=[a-z])/, "").replace(/[^a-z0-9]/g, "");
}

function normalizeGradleProjectName(value: string, collapse = true): string {
  const lower = value.replace(/^:+/, "").toLowerCase();
  return collapse ? lower.replace(/[^a-z0-9]/g, "") : lower;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDocsTestAssessment(assessment: RawAnalysis["testAssessment"]): RawAnalysis["testAssessment"] {
  const summary =
    assessment.summary && !/git diff --check/i.test(assessment.summary)
      ? assessment.summary
      : "This is a documentation-only PR. The useful verification is whether the changed docs build and render correctly.";
  return {
    ...assessment,
    rating: assessment.rating === "unknown" || assessment.rating === "weak" ? "partial" : assessment.rating,
    summary,
    gaps: assessment.gaps.filter((gap) => !isGenericDiffCheck(gap)),
    recommendedTests: dedupeText([
      "Build/render the documentation and inspect the changed page or section.",
      ...assessment.recommendedTests.filter((item) => !isGenericDiffCheck(item))
    ]).slice(0, 3)
  };
}

function normalizeDocsTestAssessmentReferences(assessment: RawAnalysis["testAssessment"]): RawAnalysis["testAssessment"] {
  return {
    ...assessment,
    summary: replaceGenericDiffCheckReference(assessment.summary),
    gaps: assessment.gaps.filter((gap) => !isGenericDiffCheck(gap)),
    recommendedTests: dedupeText([
      ...assessment.recommendedTests.filter((item) => !isGenericDiffCheck(item))
    ])
  };
}

function replaceGenericDiffCheckReference(item: string): string {
  return item
    .replace(/\bCI results beyond `?git diff --check`?\b/gi, "CI results or rendered-doc evidence")
    .replace(/`?git diff --check`?/gi, "rendered-doc evidence")
    .replace(/\bonly covered by rendered-doc evidence\b/i, "not yet covered by rendered-doc evidence")
    .replace(/\brendered documentation output or CI results or rendered-doc evidence\b/i, "rendered documentation output, CI results, or screenshot evidence");
}

function isDocsOnlyDetail(detail: PrDetail): boolean {
  return detail.files.length > 0 && detail.files.every((file) => isDocsPath(file.path));
}

function isDocsPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.startsWith("docs/") ||
    lower.startsWith("src/main/docs/") ||
    lower.endsWith(".adoc") ||
    lower.endsWith(".md") ||
    lower.endsWith(".rst") ||
    lower.endsWith(".txt")
  );
}

function docsRenderVerificationItem(detail: PrDetail): string {
  const changedDocs = detail.files.filter((file) => isDocsPath(file.path)).map((file) => file.path);
  const target = changedDocs.length === 1 ? changedDocs[0] : `${changedDocs.length} changed documentation files`;
  return `Build/render documentation and inspect the changed docs output for ${target}. Capture screenshot or rendered HTML evidence if the docs build produces a page.`;
}

function isGenericDiffCheck(item: string): boolean {
  const text = item.toLowerCase();
  return /\bgit\s+diff\s+--check\b/.test(text) || /\bwhitespace-only\b/.test(text);
}

function isDocRenderCheck(item: string): boolean {
  return /\b(build|render|screenshot|html|site)\b/i.test(item) && /\b(docs?|documentation|asciidoc|adoc|guide)\b/i.test(item);
}

function dedupeText(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const cleaned = item.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

export function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error("The agent did not return a JSON object");
}

export function typeDisplayName(type: AnalysisType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
