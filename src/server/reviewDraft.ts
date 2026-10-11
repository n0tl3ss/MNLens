import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AcceptanceContract, AnalysisResult, PrDetail, RepoReviewRule, ReviewDraft, SuggestedReviewComment } from "../shared/types.js";
import { annotateDiff, resolveAnchor, type AnnotatedDiff } from "../shared/diffLines.js";
import { readAcceptanceContract, effectiveStatus } from "./acceptance.js";
import { agentDisplayName, codexSchemaPathFor, runAgent } from "./agent.js";
import { reviewDraftInstructions } from "./agentSkills.js";
import { readAnalysis, readRepoRules } from "./cache.js";
import { extractJson } from "./codex.js";
import { cacheDir, projectRoot } from "./paths.js";
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
        criterion: z.string().nullable().optional()
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
          required: ["path", "side", "line", "kind", "title", "body", "rationale", "criterion"],
          properties: {
            path: { type: "string" },
            side: { type: "string", enum: ["LEFT", "RIGHT"] },
            line: { type: ["integer", "null"] },
            kind: { type: "string", enum: ["blocking", "important", "suggestion", "nit", "question", "praise"] },
            title: { type: "string" },
            body: { type: "string" },
            rationale: { type: "string" },
            criterion: { type: ["string", "null"] }
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

  const [analysis, acceptance, rules, calibration] = await Promise.all([
    readAnalysis(detail.key),
    readAcceptanceContract(detail.key),
    readRepoRules(detail.repository).catch(() => [] as RepoReviewRule[]),
    calibrationPromptBlock(detail.repository).catch(() => "")
  ]);
  const annotated = annotateDiff(detail.diff);
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
        calibration
      }),
      access: "read-only",
      cwd: projectRoot,
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
      unanchored: anchor.unanchored || undefined
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
  context: { analysis?: AnalysisResult; acceptance?: AcceptanceContract; repoRules: string[]; calibration: string }
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
        caveats: context.analysis.caveats,
        secondOpinion: context.analysis.secondOpinion ? { verdict: context.analysis.secondOpinion.verdict, disputed: context.analysis.secondOpinion.disputed, missed: context.analysis.secondOpinion.missed } : undefined
      }
    : undefined;
  const acceptance = context.acceptance
    ? context.acceptance.criteria.map((criterion) => ({ text: criterion.text, status: effectiveStatus(criterion), humanOverride: Boolean(criterion.humanStatus), evidence: criterion.evidence.map((item) => `${item.kind}:${item.ref}`), note: criterion.humanNote ?? criterion.note }))
    : undefined;
  const existingThreads = (detail.reviewComments ?? []).slice(0, 30).map((comment) => ({ path: comment.path, line: comment.line, side: comment.side, author: comment.author, resolved: comment.isResolved, body: comment.body.slice(0, 300) }));
  return `${reviewDraftInstructions()}
${context.repoRules.length > 0 ? `\nRepository review rules set by the maintainers (follow them):\n${context.repoRules.map((rule) => `- ${rule}`).join("\n")}\n` : ""}${context.calibration ? `\n${context.calibration}\n` : ""}
Pull request:
${JSON.stringify({ repository: detail.repository, number: detail.number, title: detail.title, author: detail.author, body: detail.body, baseRefName: detail.baseRefName, isDraft: detail.isDraft, files: detail.files, linkedIssues: (detail.linkedIssues ?? []).map((issue) => ({ number: issue.number, title: issue.title, body: (issue.body ?? "").slice(0, 3000) })) }, null, 2)}

${analysis ? `Prior analysis of this PR (use it, but verify against the diff):\n${JSON.stringify(analysis, null, 2)}\n` : "No prior analysis is available; work from the diff."}
${acceptance ? `Acceptance criteria and their current status (human overrides are authoritative):\n${JSON.stringify(acceptance, null, 2)}\n` : "No acceptance contract exists yet."}
${existingThreads.length > 0 ? `Existing review threads (do not repeat points already raised unless unresolved and still wrong):\n${JSON.stringify(existingThreads, null, 2)}\n` : ""}
Files in the diff: ${annotated.files.join(", ") || "(none)"}

Annotated diff:
${annotated.text}
`;
}
