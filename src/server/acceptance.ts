import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AcceptanceContract, AcceptanceCriterion, CiCheck, CriterionStatus, PrDetail, UpdateCriterionRequest, VerificationJob } from "../shared/types.js";
import { acceptanceTotals, effectiveCriterionStatus } from "../shared/acceptance.js";
import { enqueueVerification, parseVerificationCommand } from "./verification.js";
import { budgetDiff } from "./diffBudget.js";
import { commandCovers } from "../shared/acceptance.js";
import { agentDisplayName, codexSchemaPathFor, runAgent } from "./agent.js";
import { readAnalysis, readVerificationJobsForPr } from "./cache.js";
import { ensureAnalysisWorktree, extractJson } from "./codex.js";
import { cacheDir } from "./paths.js";

/**
 * Acceptance-criteria contract.
 *
 * Turns "does this PR do what was asked?" into a checklist with evidence.
 * Criteria are extracted from the linked issues and PR body (and derived from
 * the diff when neither states them), then each one is marked proven /
 * unproven / failed / not-applicable with concrete evidence: a test name, a
 * `path:line`, a CI check, a command that was run, or a docs section. The
 * agent works inside a read-only checkout of the PR so it can actually open
 * the tests instead of guessing from the diff.
 *
 * The reviewer can override any status; human verdicts win and are kept
 * across regenerations for criteria with the same text.
 */

const contractDir = join(cacheDir, "acceptance");

const statusSchema = z.enum(["proven", "unproven", "failed", "not-applicable"]).default("unproven");

const criterionSchema = z.object({
  text: z.string().default(""),
  source: z.enum(["linked-issue", "pr-body", "derived"]).default("derived"),
  origin: z.string().default(""),
  status: statusSchema,
  evidence: z
    .array(z.object({ kind: z.enum(["test", "file", "ci", "command", "comment", "docs"]).default("file"), ref: z.string().default(""), note: z.string().default("") }))
    .default([]),
  note: z.string().default(""),
  command: z.string().default("")
});

const contractSchema = z.object({
  summary: z.string().default(""),
  criteria: z.array(criterionSchema).default([]),
  limitations: z.array(z.string()).default([])
});

export function acceptanceJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "criteria", "limitations"],
    properties: {
      summary: { type: "string" },
      limitations: { type: "array", items: { type: "string" } },
      criteria: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "source", "origin", "status", "evidence", "note", "command"],
          properties: {
            text: { type: "string" },
            source: { type: "string", enum: ["linked-issue", "pr-body", "derived"] },
            origin: { type: "string" },
            status: { type: "string", enum: ["proven", "unproven", "failed", "not-applicable"] },
            note: { type: "string" },
            command: { type: "string" },
            evidence: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "ref", "note"],
                properties: { kind: { type: "string", enum: ["test", "file", "ci", "command", "comment", "docs"] }, ref: { type: "string" }, note: { type: "string" } }
              }
            }
          }
        }
      }
    }
  };
}

export async function readAcceptanceContract(prKey: string): Promise<AcceptanceContract | undefined> {
  try {
    return JSON.parse(await readFile(join(contractDir, `${prKey}.json`), "utf8")) as AcceptanceContract;
  } catch {
    return undefined;
  }
}

export async function writeAcceptanceContract(contract: AcceptanceContract): Promise<void> {
  await mkdir(contractDir, { recursive: true });
  await writeFile(join(contractDir, `${contract.prKey}.json`), JSON.stringify(contract, null, 2));
}

export async function generateAcceptanceContract(
  detail: PrDetail,
  options: { force?: boolean; ciChecks?: CiCheck[]; autoVerify?: boolean; onStatus?: (message: string) => void } = {}
): Promise<AcceptanceContract> {
  const existing = await readAcceptanceContract(detail.key);
  if (existing && !options.force && existing.diffHash === detail.diffHash) return existing;

  options.onStatus?.("Preparing a read-only PR checkout so tests can be inspected.");
  const repoDir = await ensureAnalysisWorktree(detail).catch(() => undefined);
  const analysis = await readAnalysis(detail.key);
  const verificationJobs = await readVerificationJobsForPr(detail.key);
  const outputPath = join(cacheDir, "agent-output", `${detail.key}-acceptance-${Date.now()}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  const schema = acceptanceJsonSchema();
  await writeFile(codexSchemaPathFor(outputPath), JSON.stringify(schema, null, 2));

  options.onStatus?.("Mapping acceptance criteria to tests, code and CI evidence.");
  const { invocation, output, result } = await runAgent(
    {
      task: "acceptance-contract",
      prKey: detail.key,
      prompt: buildAcceptancePrompt(detail, { analysisSummary: analysis?.summary, testsToCheck: analysis?.testsToCheck ?? [], ciChecks: options.ciChecks ?? [], verificationJobs, hasCheckout: Boolean(repoDir) }),
      access: "read-only",
      cwd: repoDir ?? process.cwd(),
      outputSchema: schema,
      outputLastMessagePath: outputPath
    },
    { timeoutMs: 8 * 60_000 }
  );
  if (output.isError) throw new Error(output.text || `${invocation.label} failed to build the acceptance contract.`);
  const rawText = invocation.agent === "codex" ? await readFile(outputPath, "utf8").catch(() => result.stdout) : output.text;
  const parsed = contractSchema.parse(output.structured && typeof output.structured === "object" ? output.structured : JSON.parse(extractJson(rawText)));

  const criteria: AcceptanceCriterion[] = parsed.criteria
    .filter((item) => item.text.trim())
    .map((item) => {
      const previous = existing?.criteria.find((candidate) => normalizeText(candidate.text) === normalizeText(item.text));
      return {
        id: previous?.id ?? randomUUID(),
        text: item.text.trim(),
        source: item.source,
        origin: item.origin || undefined,
        status: item.status,
        evidence: item.evidence.filter((evidence) => evidence.ref.trim()).map((evidence) => ({ kind: evidence.kind, ref: evidence.ref.trim(), note: evidence.note || undefined })),
        note: item.note || undefined,
        command: item.command.trim() || undefined,
        // Human overrides survive regeneration as long as the criterion text is the same.
        humanStatus: previous?.humanStatus,
        humanNote: previous?.humanNote,
        humanUpdatedAt: previous?.humanUpdatedAt
      };
    });

  const contract: AcceptanceContract = {
    prKey: detail.key,
    diffHash: detail.diffHash,
    generatedAt: new Date().toISOString(),
    agent: invocation.agent,
    model: invocation.model,
    costUsd: output.costUsd,
    summary: parsed.summary,
    criteria,
    limitations: parsed.limitations
  };
  await writeAcceptanceContract(contract);
  options.onStatus?.(`${agentDisplayName(invocation.agent)} mapped ${criteria.length} criteria.`);
  if (options.autoVerify ?? true) await scheduleAcceptanceVerification(contract, detail, options.onStatus);
  return contract;
}

/**
 * Up to three distinct, runnable commands the contract names, in order of first
 * appearance. A Gradle/Maven test command whose `--tests` filters are a subset of
 * another command's (same project and task) is covered by that one and skipped,
 * so three criteria that name overlapping specs cost one build, not three.
 */
export function acceptanceCommands(contract: Pick<AcceptanceContract, "criteria">, limit = 3): string[] {
  const commands: string[] = [];
  for (const criterion of contract.criteria) {
    const parsed = criterion.command ? parseVerificationCommand(criterion.command) : undefined;
    if (parsed && !commands.includes(parsed.display)) commands.push(parsed.display);
  }
  const covered = commands.filter((command, index) => !commands.some((other, otherIndex) => otherIndex !== index && other !== command && commandCovers(other, command)));
  return covered.slice(0, limit);
}

/**
 * "Proven" should mean "ran": start a local verification job for each command
 * the contract names and attach the job to every criterion it covers. Results
 * flow back through the verification job list; see shared/acceptance.ts for
 * how a failed run turns a criterion red.
 */
export async function scheduleAcceptanceVerification(contract: AcceptanceContract, pr: Pick<PrDetail, "owner" | "repo" | "number">, onStatus?: (message: string) => void): Promise<AcceptanceContract> {
  const commands = acceptanceCommands(contract);
  if (commands.length === 0) return contract;
  onStatus?.(`Starting ${commands.length} local test run${commands.length === 1 ? "" : "s"} for the acceptance criteria.`);
  for (const command of commands) {
    try {
      const job = await enqueueVerification({ owner: pr.owner, repo: pr.repo, number: pr.number }, command);
      for (const criterion of contract.criteria) {
        const parsed = criterion.command ? parseVerificationCommand(criterion.command) : undefined;
        if (parsed && commandCovers(command, parsed.display)) criterion.verification = { jobId: job.id, command, startedAt: job.createdAt };
      }
    } catch (error) {
      contract.limitations.push(`Could not run \`${command}\`: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await writeAcceptanceContract(contract);
  return contract;
}

export async function updateCriterion(prKey: string, criterionId: string, patch: UpdateCriterionRequest): Promise<AcceptanceContract> {
  const contract = await readAcceptanceContract(prKey);
  if (!contract) throw new Error("No acceptance contract exists for this PR yet.");
  const criterion = contract.criteria.find((item) => item.id === criterionId);
  if (!criterion) throw new Error("Unknown acceptance criterion.");
  if (patch.status === null) {
    criterion.humanStatus = undefined;
    criterion.humanNote = undefined;
    criterion.humanUpdatedAt = undefined;
  } else {
    if (patch.status) criterion.humanStatus = patch.status;
    if (patch.note !== undefined) criterion.humanNote = patch.note ?? undefined;
    criterion.humanUpdatedAt = new Date().toISOString();
  }
  await writeAcceptanceContract(contract);
  return contract;
}

export function effectiveStatus(criterion: Pick<AcceptanceCriterion, "status" | "humanStatus" | "verification">, jobs: VerificationJob[] = []): CriterionStatus {
  return effectiveCriterionStatus(criterion, jobs);
}

export function contractTotals(contract: Pick<AcceptanceContract, "criteria"> | undefined, jobs: VerificationJob[] = []): ReturnType<typeof acceptanceTotals> {
  return acceptanceTotals(contract, jobs);
}

export function buildAcceptancePrompt(
  detail: PrDetail,
  context: { analysisSummary?: string; testsToCheck: string[]; ciChecks: CiCheck[]; verificationJobs: VerificationJob[]; hasCheckout: boolean }
): string {
  const { text: diff } = budgetDiff(detail.diff, 90_000, { hasCheckout: context.hasCheckout });
  const verification = context.verificationJobs.slice(0, 10).map((job) => ({ command: job.command, status: job.status, exitCode: job.exitCode, completedAt: job.completedAt }));
  const ci = context.ciChecks.map((check) => ({ name: check.name, workflow: check.workflow, state: check.state, bucket: check.bucket }));
  return `You are producing an acceptance-criteria contract for a GitHub pull request so a human reviewer can see, item by item, whether the PR does what was asked and what proves it.

Return only JSON matching the provided schema. Do not wrap it in Markdown.

Step 1 — extract criteria:
- From linked issues first (source "linked-issue", origin "#<number>"), then from the PR body (source "pr-body", origin "PR body"). Keep the author's wording where it is testable; split compound sentences into separate criteria.
- Only when neither states criteria, derive 2-6 from the diff (source "derived") describing the observable behavior the change introduces. Do not invent requirements nobody asked for.
- Include non-functional expectations that are explicit in the issue/PR (performance, compatibility, docs, migration) as criteria.

Step 2 — judge each criterion against the code:
${context.hasCheckout ? "- You have a read-only checkout of the PR. Open the changed source and the tests with the Read tool and find tests for the changed symbols with Grep; do not rely on the diff alone. Bash is limited to read-only git, rg and grep (cat, ls and build commands are denied), and you do not run tests yourself: MNLens runs the `command` you name on each criterion after you answer and reports the result next to it." : "- No checkout is available; judge from the diff, file list and CI/verification data, and say so in limitations."}
- "proven": there is a test, CI check, or local verification run that exercises exactly this behavior and would fail without the change, OR the code path is trivially inspectable and you cite path:line. Every proven item needs at least one evidence entry.
- "failed": the code or tests show the criterion is NOT met.
- "unproven": the change looks intended to meet it but nothing exercises it; say what test would prove it in the note.
- "not-applicable": the criterion is out of scope for this PR or explicitly deferred by the author (cite the comment).
- Evidence refs must be real: test method/class names you saw, path:line ranges, CI check names from the CI list, or commands from the verification list. Never fabricate a test name.
- "command": the exact local command, from the repository root, that exercises this criterion: the project's wrapper (./gradlew, ./mvnw, npm ...), the exact project path and test class, e.g. ./gradlew :micronaut-foo:test --tests '*BarSpec'. Use the repository's own guidance and build files for the project path and task names; one command may cover several criteria, and it should be the narrowest target that proves them. Exactly one command, never a chain with && or ;: when two targets are needed, name the one that proves this criterion and let another criterion carry the other. Leave it empty when nothing runnable exists. MNLens runs these commands and marks a criterion failed when its command fails, so never name a command you have not seen in the build.

Step 3 — limitations: list what you could not verify locally (external services, credentials, UI judgment) so the human knows what remains manual.

Keep criteria to the ones that matter (typically 3-10). Be concise.

Pull request:
${JSON.stringify({ repository: detail.repository, number: detail.number, title: detail.title, body: detail.body, baseRefName: detail.baseRefName, files: detail.files }, null, 2)}

Linked issues:
${JSON.stringify((detail.linkedIssues ?? []).map((issue) => ({ number: issue.number, title: issue.title, state: issue.state, body: (issue.body ?? "").slice(0, 6000), url: issue.url })), null, 2)}

Existing review context:
${JSON.stringify({ analysisSummary: context.analysisSummary ?? "", testsToCheck: context.testsToCheck, ciChecks: ci, localVerificationRuns: verification }, null, 2)}

Diff:
${diff}
`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
