import { budgetDiff } from "./diffBudget.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { AcceptanceContract, AnalysisResult, PrDetail, RepoReviewRule, ReviewDraft, SuggestedReviewComment, VerificationJob } from "../shared/types.js";
import { annotateDiff, resolveAnchor, type AnnotatedDiff } from "../shared/diffLines.js";
import { readAcceptanceContract, effectiveStatus } from "./acceptance.js";
import { agentDisplayName, agentScratchDir, codexSchemaPathFor, runAgent } from "./agent.js";
import { reviewDraftInstructions } from "./agentSkills.js";
import { readAnalysis, readVerificationJobsForPr } from "./cache.js";
import { listRepoRules } from "./repoRules.js";
import { ensureAnalysisWorktree, extractJson, readRepoGuidance, repoGuidancePromptBlock, type RepoGuidance } from "./codex.js";
import { cacheDir } from "./paths.js";
import { calibrationPromptBlock } from "./reviewMemory.js";

/**
 * Review draft.
 *
 * Deep Analyze explains the PR; the acceptance contract says whether it does
 * what was asked. The review draft is the missing last step: the review the
 * agent would actually *post* — inline comments anchored to diff lines, the
 * final summary comment, a verdict — and an ordered checklist of what the
 * human must / should / may still do before deciding.
 *
 * Anchors are validated against the diff (see shared/diffLines.ts) so a
 * suggested comment can be dropped straight into the review draft without the
 * GitHub API rejecting it. Comments the agent could not anchor are kept but
 * flagged `unanchored` so the reviewer can place them by hand.
 */

const draftDir = join(cacheDir, "review-drafts");

const kindSchema = z.enum(["blocking", "important", "suggestion", "nit", "question", "praise"]).catch("suggestion");

const draftSchema = z.object({
  decision: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).catch("COMMENT"),
  decisionRationale: z.string().default(""),
  finalComment: z.string().default(""),
  comments: z
    .array(
      z.object({
        path: z.string().default(""),
        side: z.enum(["LEFT", "RIGHT"]).catch("RIGHT"),
        line: z.number().nullable().optional(),
        kind: kindSchema,
        title: z.string().default(""),
        body: z.string().default(""),
        rationale: z.string().default(""),
        criterion: z.string().nullable().optional(),
        suggestion: z.string().nullable().optional()
      })
    )
    .default([]),
  mustDo: z.array(z.string()).default([]),
  shouldDo: z.array(z.string()).default([]),
  optional: z.array(z.string()).default([])
});

export function reviewDraftJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["decision", "decisionRationale", "finalComment", "comments", "mustDo", "shouldDo", "optional"],
    properties: {
      decision: { type: "string", enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"] },
      decisionRationale: { type: "string" },
      finalComment: { type: "string" },
      comments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "side", "line", "kind", "title", "body", "rationale", "criterion", "suggestion"],
          properties: {
            path: { type: "string" },
            side: { type: "string", enum: ["LEFT", "RIGHT"] },
            line: { type: ["integer", "null"] },
            kind: { type: "string", enum: ["blocking", "important", "suggestion", "nit", "question", "praise"] },
            title: { type: "string" },
            body: { type: "string" },
            rationale: { type: "string" },
            criterion: { type: ["string", "null"] },
            suggestion: { type: ["string", "null"] }
          }
        }
      },
      mustDo: { type: "array", items: { type: "string" } },
      shouldDo: { type: "array", items: { type: "string" } },
      optional: { type: "array", items: { type: "string" } }
    }
  };
}

export async function readReviewDraft(prKey: string): Promise<ReviewDraft | undefined> {
  try {
    return JSON.parse(await readFile(join(draftDir, `${prKey}.json`), "utf8")) as ReviewDraft;
  } catch {
    return undefined;
  }
}

export async function writeReviewDraft(draft: ReviewDraft): Promise<void> {
  await mkdir(draftDir, { recursive: true });
  await writeFile(join(draftDir, `${draft.prKey}.json`), JSON.stringify(draft, null, 2));
}

export async function generateReviewDraft(detail: PrDetail, options: { force?: boolean; onStatus?: (message: string) => void } = {}): Promise<ReviewDraft> {
  const existing = await readReviewDraft(detail.key);
  if (existing && !options.force && existing.diffHash === detail.diffHash) return existing;

  const [analysis, acceptance, rules, calibration, verificationJobs] = await Promise.all([
    readAnalysis(detail.key),
    readAcceptanceContract(detail.key),
    listRepoRules(detail.repository).catch(() => [] as RepoReviewRule[]),
    calibrationPromptBlock(detail.repository).catch(() => ""),
    readVerificationJobsForPr(detail.key).catch(() => [] as VerificationJob[])
  ]);
  // Whole files within the budget, omitted files listed by path; the annotation adds line numbers, so its own cap sits above the budget.
  // The draft runs in the same read-only checkout as Deep Analyze, so it can open the files behind a comment before anchoring it.
  const repoDir = await ensureAnalysisWorktree(detail).catch(() => undefined);
  const annotated = annotateDiff(budgetDiff(detail.diff, 100_000, { hasCheckout: Boolean(repoDir) }).text, { maxChars: 200_000 });
  // Reuse the analysis checkout when it exists (no git operations here); the draft then follows the repo's own conventions.
  const worktree = join(cacheDir, "analysis-worktrees", detail.key);
  const repoGuidance = existsSync(worktree) ? await readRepoGuidance(worktree).catch(() => [] as RepoGuidance[]) : [];
  const outputPath = join(cacheDir, "agent-output", `${detail.key}-review-draft-${Date.now()}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  const schema = reviewDraftJsonSchema();
  await writeFile(codexSchemaPathFor(outputPath), JSON.stringify(schema, null, 2));

  options.onStatus?.("Drafting inline comments and the final review comment.");
  const { invocation, output, result } = await runAgent(
    {
      task: "review-draft",
      prKey: detail.key,
      prompt: buildReviewDraftPrompt(detail, annotated, {
        analysis: analysis?.diffHash === detail.diffHash ? analysis : undefined,
        acceptance: acceptance?.diffHash === detail.diffHash ? acceptance : undefined,
        repoRules: rules.filter((rule) => rule.enabled).map((rule) => `${rule.title}: ${rule.body}`),
        calibration,
        repoGuidance,
        verificationJobs,
        hasCheckout: Boolean(repoDir)
      }),
      access: "read-only",
      cwd: repoDir ?? (await agentScratchDir()),
      outputSchema: schema,
      outputLastMessagePath: outputPath
    },
    { timeoutMs: 8 * 60_000 }
  );
  if (output.isError) throw new Error(output.text || `${invocation.label} failed to draft the review.`);
  const rawText = invocation.agent === "codex" ? await readFile(outputPath, "utf8").catch(() => result.stdout) : output.text;
  const parsed = draftSchema.parse(output.structured && typeof output.structured === "object" ? output.structured : JSON.parse(extractJson(rawText)));

  const draft: ReviewDraft = {
    prKey: detail.key,
    diffHash: detail.diffHash,
    generatedAt: new Date().toISOString(),
    agent: invocation.agent,
    model: invocation.model,
    costUsd: output.costUsd,
    decision: parsed.decision,
    decisionRationale: parsed.decisionRationale.trim(),
    finalComment: parsed.finalComment.trim(),
    comments: normalizeComments(parsed.comments, annotated),
    mustDo: cleanList(parsed.mustDo),
    shouldDo: cleanList(parsed.shouldDo),
    optional: cleanList(parsed.optional)
  };
  await writeReviewDraft(draft);
  options.onStatus?.(`${agentDisplayName(invocation.agent)} drafted ${draft.comments.length} comments (${draft.decision}).`);
  return draft;
}

type RawComment = z.infer<typeof draftSchema>["comments"][number];

export function normalizeComments(comments: RawComment[], annotated: Pick<AnnotatedDiff, "anchors" | "changedLinesByPath">): SuggestedReviewComment[] {
  const seen = new Set<string>();
  const result: SuggestedReviewComment[] = [];
  for (const comment of comments) {
    const body = comment.body.trim();
    if (!body || !comment.path.trim()) continue;
    const anchor = resolveAnchor(annotated, { path: comment.path, side: comment.side, line: comment.line ?? undefined });
    const dedupeKey = `${anchor.path}|${anchor.side}|${anchor.line ?? "?"}|${body.slice(0, 80).toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push({
      id: randomUUID(),
      path: anchor.path,
      side: anchor.side,
      line: anchor.line,
      kind: comment.kind,
      title: comment.title.trim() || body.split("\n")[0].slice(0, 80),
      body,
      rationale: comment.rationale.trim(),
      criterion: comment.criterion?.trim() || undefined,
      unanchored: anchor.unanchored || undefined,
      // A suggestion replaces the anchored line, so it only makes sense for a resolved RIGHT-side anchor.
      suggestion: !anchor.unanchored && anchor.side === "RIGHT" && anchor.line !== undefined && comment.suggestion?.trim() ? comment.suggestion.replace(/\s+$/, "") : undefined
    });
  }
  return result.sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
}

const kindOrder: SuggestedReviewComment["kind"][] = ["blocking", "important", "question", "suggestion", "nit", "praise"];

export function kindRank(kind: SuggestedReviewComment["kind"]): number {
  const index = kindOrder.indexOf(kind);
  return index === -1 ? kindOrder.length : index;
}

function cleanList(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

export function buildReviewDraftPrompt(
  detail: PrDetail,
  annotated: Pick<AnnotatedDiff, "text" | "files">,
  context: { analysis?: AnalysisResult; acceptance?: AcceptanceContract; repoRules: string[]; calibration: string; repoGuidance?: RepoGuidance[]; verificationJobs?: VerificationJob[]; hasCheckout?: boolean }
): string {
  const analysis = context.analysis
    ? {
        type: context.analysis.type,
        summary: context.analysis.summary,
        behaviorBefore: context.analysis.behaviorBefore,
        behaviorAfter: context.analysis.behaviorAfter,
        reviewerFocus: context.analysis.reviewerFocusDetails ?? context.analysis.reviewerFocus,
        risks: context.analysis.riskDetails ?? context.analysis.risks,
        testAssessment: context.analysis.testAssessment,
        assumptions: context.analysis.assumptions ?? [],
        edgeCases: context.analysis.edgeCases ?? [],
        caveats: context.analysis.caveats,
        secondOpinion: context.analysis.secondOpinion ? { verdict: context.analysis.secondOpinion.verdict, disputed: context.analysis.secondOpinion.disputed, missed: context.analysis.secondOpinion.missed } : undefined
      }
    : undefined;
  const acceptance = context.acceptance
    ? context.acceptance.criteria.map((criterion) => ({ text: criterion.text, status: effectiveStatus(criterion, context.verificationJobs ?? []), humanOverride: Boolean(criterion.humanStatus), evidence: criterion.evidence.map((item) => `${item.kind}:${item.ref}`), command: criterion.command, note: criterion.humanNote ?? criterion.note }))
    : undefined;
  const existingThreads = (detail.reviewComments ?? []).slice(0, 30).map((comment) => ({ path: comment.path, line: comment.line, side: comment.side, author: comment.author, resolved: comment.isResolved, body: comment.body.slice(0, 300) }));
  const localRuns = (context.verificationJobs ?? [])
    .filter((job) => job.status === "done" || job.status === "failed")
    .slice(-10)
    .reverse()
    .map((job) => ({ command: job.command, outcome: job.outcome ?? (job.exitCode === 0 ? "passed" : "failed"), blockedReason: job.blockedReason, completedAt: job.completedAt }));
  const checkout = context.hasCheckout
    ? "\nYou are working inside a read-only checkout of the PR at its head commit. Open files with the Read tool and search with Grep or Glob (Bash is limited to read-only git, rg and grep; cat, ls and build commands are denied, and a denied command is not a reason to stop). Before anchoring a comment, read the surrounding code so the line and the claim are right; read any file the diff lists as omitted.\n"
    : "";
  return `${reviewDraftInstructions()}${checkout}
${context.repoRules.length > 0 ? `\nRepository review rules set by the maintainers (follow them):\n${context.repoRules.map((rule) => `- ${rule}`).join("\n")}\n` : ""}${context.calibration ? `\n${context.calibration}\n` : ""}${repoGuidancePromptBlock(context.repoGuidance)}
Pull request:
${JSON.stringify({ repository: detail.repository, number: detail.number, title: detail.title, author: detail.author, body: detail.body, baseRefName: detail.baseRefName, isDraft: detail.isDraft, files: detail.files, linkedIssues: (detail.linkedIssues ?? []).map((issue) => ({ number: issue.number, title: issue.title, body: (issue.body ?? "").slice(0, 3000) })) }, null, 2)}

${analysis ? `Prior analysis of this PR (use it, but verify against the diff):\n${JSON.stringify(analysis, null, 2)}\n` : "No prior analysis is available; work from the diff."}
${acceptance ? `Acceptance criteria and their current status (human overrides are authoritative):\n${JSON.stringify(acceptance, null, 2)}\n` : "No acceptance contract exists yet."}
${localRuns.length > 0 ? `Local verification runs MNLens already executed in a checkout of this PR, newest first. A run that passed is evidence: cite it in the final comment and never ask the human to run it again. A blocked run never started and proves nothing either way:\n${JSON.stringify(localRuns, null, 2)}\n` : ""}
${existingThreads.length > 0 ? `Existing review threads (do not repeat points already raised unless unresolved and still wrong):\n${JSON.stringify(existingThreads, null, 2)}\n` : ""}
Files in the diff: ${annotated.files.join(", ") || "(none)"}

Annotated diff:
${annotated.text}
`;
}
