import { z } from "zod";
import type { AgentId, AnalysisResult, ModelTier, PrDetail, SecondOpinion } from "../shared/types.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { agentDisplayName, agentScratchDir, codexSchemaPathFor, runAgent } from "./agent.js";
import { readAgentSettings, resolveTierModel } from "./agentSettings.js";
import { readAnalysis, writeAnalysis } from "./cache.js";
import { extractJson } from "./codex.js";
import { cacheDir } from "./paths.js";

/**
 * Second opinion.
 *
 * One model's review guidance is a single sample: it can hallucinate a risk,
 * miss an edge case, or over-weight style. Because MNLens now drives two
 * independent agents behind one interface, it can cheaply ask the *other*
 * vendor's economy-tier model to audit the first analysis against the diff.
 * Disagreements are where the human reviewer's attention pays off most; broad
 * agreement raises confidence in approving quickly.
 *
 * Cost: economy tier (~$0.10/$0.50 per 1M tokens), a fraction of the analysis.
 */

const severity = z.enum(["info", "low", "medium", "high"]).default("medium");

const opinionSchema = z.object({
  verdict: z.enum(["agree", "mostly-agree", "disagree"]).default("mostly-agree"),
  confidence: z.number().min(0).max(1).catch(0.5),
  summary: z.string().default(""),
  agreements: z.array(z.string()).default([]),
  disputed: z.array(z.object({ item: z.string().default(""), reason: z.string().default(""), severity })).default([]),
  missed: z.array(z.object({ title: z.string().default(""), observation: z.string().default(""), recommendation: z.string().default(""), severity })).default([]),
  draftCommentIssues: z.array(z.string()).default([])
});

export function opinionJsonSchema(): Record<string, unknown> {
  const sev = { type: "string", enum: ["info", "low", "medium", "high"] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "confidence", "summary", "agreements", "disputed", "missed", "draftCommentIssues"],
    properties: {
      verdict: { type: "string", enum: ["agree", "mostly-agree", "disagree"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      summary: { type: "string" },
      agreements: { type: "array", items: { type: "string" } },
      disputed: { type: "array", items: { type: "object", additionalProperties: false, required: ["item", "reason", "severity"], properties: { item: { type: "string" }, reason: { type: "string" }, severity: sev } } },
      missed: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["title", "observation", "recommendation", "severity"], properties: { title: { type: "string" }, observation: { type: "string" }, recommendation: { type: "string" }, severity: sev } }
      },
      draftCommentIssues: { type: "array", items: { type: "string" } }
    }
  };
}

export function otherAgent(agent: AgentId): AgentId {
  return agent === "claude" ? "codex" : "claude";
}

export async function secondOpinionFor(detail: PrDetail, hooks: { onStatus?: (message: string) => void } = {}): Promise<AnalysisResult> {
  const analysis = await readAnalysis(detail.key);
  if (!analysis) throw new Error("Run Deep Analyze first; a second opinion audits an existing analysis.");
  if (analysis.diffHash !== detail.diffHash) throw new Error("The PR diff changed since the analysis. Re-run Deep Analyze before asking for a second opinion.");
  const settings = await readAgentSettings();
  const primary = analysis.agent ?? settings.agent;
  let reviewer = otherAgent(primary);
  hooks.onStatus?.(`Asking ${agentDisplayName(reviewer)} to audit the ${agentDisplayName(primary)} analysis.`);
  const outputPath = join(cacheDir, "agent-output", `${detail.key}-second-opinion-${Date.now()}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  const schema = opinionJsonSchema();
  await writeFile(codexSchemaPathFor(outputPath), JSON.stringify(schema, null, 2));
  const audit = async (agent: AgentId, tier?: ModelTier) =>
    runAgent(
      {
        task: "second-opinion",
        prKey: detail.key,
        agent,
        tier,
        prompt: buildSecondOpinionPrompt(detail, analysis, primary, agent === primary),
        access: "read-only",
        cwd: await agentScratchDir(),
        outputSchema: schema,
        outputLastMessagePath: outputPath
      },
      { timeoutMs: 6 * 60_000 }
    );
  let fallbackReason: string | undefined;
  let run: Awaited<ReturnType<typeof audit>>;
  try {
    run = await audit(reviewer);
    if (run.output.isError) throw new Error(run.output.text || `${run.invocation.label} failed to produce a second opinion.`);
  } catch (error) {
    // The other vendor's CLI is missing or signed out. A different model from the same vendor is still an
    // independent sample of the diff, so audit with it rather than leaving the reviewer without a check.
    // The reading pass is the run that judged the PR, so its tier is the one to differ from.
    const analysisTier = resolveTierModel(settings, primary, "analysis-reading").tier;
    const fallbackTier: ModelTier = analysisTier === "premium" ? "standard" : "premium";
    fallbackReason = `${agentDisplayName(reviewer)} is not available (${compactError(error)}); ${agentDisplayName(primary)} audited on the ${fallbackTier} tier instead.`;
    hooks.onStatus?.(fallbackReason);
    reviewer = primary;
    run = await audit(primary, fallbackTier);
    if (run.output.isError) throw new Error(run.output.text || `${run.invocation.label} failed to produce a second opinion.`);
  }
  const { invocation, output, result } = run;
  const rawText = reviewer === "codex" ? await readFile(outputPath, "utf8").catch(() => result.stdout) : output.text;
  const parsed = opinionSchema.parse(output.structured && typeof output.structured === "object" ? output.structured : JSON.parse(extractJson(rawText)));
  const secondOpinion: SecondOpinion = {
    agent: reviewer,
    model: invocation.model,
    generatedAt: new Date().toISOString(),
    diffHash: detail.diffHash,
    costUsd: output.costUsd,
    ...parsed,
    fallbackReason
  };
  const next: AnalysisResult = { ...analysis, secondOpinion };
  await writeAnalysis(next);
  return next;
}

function compactError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 140) ?? "unknown error";
}

export function buildSecondOpinionPrompt(detail: PrDetail, analysis: AnalysisResult, primary: AgentId, sameVendor = false): string {
  const diff = detail.diff.length > 45_000 ? `${detail.diff.slice(0, 45_000)}\n\n[Diff truncated from ${detail.diff.length} characters.]` : detail.diff;
  const firstOpinion = {
    agent: agentDisplayName(primary),
    type: analysis.type,
    confidence: analysis.confidence,
    summary: analysis.summary,
    behaviorBefore: analysis.behaviorBefore,
    behaviorAfter: analysis.behaviorAfter,
    reviewerFocus: analysis.reviewerFocusDetails ?? analysis.reviewerFocus,
    risks: analysis.riskDetails ?? analysis.risks,
    testAssessment: analysis.testAssessment,
    testsToCheck: analysis.testsToCheck,
    assumptions: analysis.assumptions ?? [],
    edgeCases: analysis.edgeCases ?? [],
    caveats: analysis.caveats,
    draftComment: analysis.draftComment
  };
  const independence = sameVendor
    ? "You are a different, stronger model from the same vendor as the first reviewer; do not assume its reading of the diff is right."
    : "You were produced by a different model vendor; your value is in catching what the first reviewer got wrong or missed, not in restating it.";
  return `You are an independent second reviewer auditing another AI's review guidance for a GitHub pull request. ${independence}

Return only JSON matching the provided schema. Do not wrap it in Markdown.

How to audit:
- Verify each risk and reviewer-focus item against the diff. Mark an item "disputed" when the diff shows it is wrong, already handled, out of scope for this PR, or so minor it would waste the human's time; explain with file/line evidence.
- Look for what was missed: behavior changes without tests, edge cases (null/empty/boundary/concurrency/compatibility), error handling, security-relevant surface, migration or config impact, and mismatches between the PR body / linked issues and the code.
- Check the test assessment honestly: would the listed tests fail before this change? Are the claimed gaps real?
- Check the assumptions and edge cases: dispute any that the diff shows do not apply, and add missed ones (a default value, an implicit contract, a boundary the code can hit) under "missed".
- Read the draft review comment as the PR author would. Flag anything inaccurate, unkind, or unsupported by the diff under draftCommentIssues.
- "agree" means you would hand the first analysis to the human unchanged; "disagree" means at least one high-severity dispute or miss.
- Be concise. Only include items that change what the human should do.

Pull request:
${JSON.stringify({ repository: detail.repository, number: detail.number, title: detail.title, body: detail.body, linkedIssues: detail.linkedIssues ?? [], baseRefName: detail.baseRefName, files: detail.files }, null, 2)}

First reviewer's analysis:
${JSON.stringify(firstOpinion, null, 2)}

Diff:
${diff}
`;
}
