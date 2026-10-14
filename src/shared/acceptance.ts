import type { AcceptanceContract, AcceptanceCriterion, CriterionStatus, VerificationJob } from "./types.js";

/**
 * Effective status of an acceptance criterion, shared by server and client.
 *
 * Precedence: the reviewer's override, then a failed local run of the command
 * that exercises the criterion, then the agent's verdict. A green run does not
 * upgrade "unproven" to "proven" on its own: proven requires a test that encodes
 * the criterion (the agent's evidence) *and* that test passing. A run that never
 * started (wrong JDK, offline) says nothing about the PR and leaves the verdict alone.
 */
export function effectiveCriterionStatus(criterion: Pick<AcceptanceCriterion, "status" | "humanStatus" | "command" | "verification">, jobs: VerificationJob[] = []): CriterionStatus {
  if (criterion.humanStatus) return criterion.humanStatus;
  if (criterionRunState(criterion, jobs) === "failed") return "failed";
  return criterion.status;
}

export type CriterionRunState = "queued" | "running" | "passed" | "failed" | "blocked";

/**
 * The local run that speaks for a criterion: the job the contract attached, or
 * a newer run of the same command (the reviewer pressed "Run again", or ran it
 * from Tests To Check). Matching by command is what lets a re-run replace a
 * stale result without rebuilding the contract.
 */
export function criterionRunJob(criterion: Pick<AcceptanceCriterion, "command" | "verification">, jobs: VerificationJob[] = []): VerificationJob | undefined {
  const attached = criterion.verification?.jobId ? jobs.find((candidate) => candidate.id === criterion.verification?.jobId) : undefined;
  const wanted = criterion.command ?? criterion.verification?.command ?? "";
  const byCommand = wanted.trim()
    ? [...jobs].filter((candidate) => commandCovers(candidate.command, wanted)).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0]
    : undefined;
  if (attached && byCommand && byCommand.id !== attached.id) return (byCommand.createdAt || "") > (attached.createdAt || "") ? byCommand : attached;
  return attached ?? byCommand;
}

/** State of the local verification run that speaks for a criterion, if any. */
export function criterionRunState(criterion: Pick<AcceptanceCriterion, "command" | "verification">, jobs: VerificationJob[] = []): CriterionRunState | undefined {
  const job = criterionRunJob(criterion, jobs);
  if (!job) return undefined;
  if (job.status === "queued") return "queued";
  if (job.status === "running") return "running";
  if (job.outcome === "blocked") return "blocked";
  if (job.outcome === "passed") return "passed";
  if (job.outcome === "test-failed") return "failed";
  if (job.status === "failed" || (typeof job.exitCode === "number" && job.exitCode !== 0)) return "failed";
  return "passed";
}

/**
 * True when running `candidate` also exercises `wanted`: the same command and
 * build target, and every `--tests` filter of `wanted` is among the candidate's
 * (a command without filters covers only itself). Shared by the server, which
 * uses it to run one build for overlapping criteria, and the client, which uses
 * it to let a broader run speak for a narrower criterion.
 */
export function commandCovers(candidate: string, wanted: string): boolean {
  const a = splitTestFilters(candidate);
  const b = splitTestFilters(wanted);
  if (a.base !== b.base) return false;
  if (b.tests.length === 0 || a.tests.length === 0) return a.tests.length === b.tests.length;
  return b.tests.every((test) => a.tests.includes(test));
}

export function splitTestFilters(command: string): { base: string; tests: string[] } {
  const tokens = command.replace(/`/g, "").replace(/['"]/g, "").trim().split(/\s+/).filter(Boolean);
  const base: string[] = [];
  const tests: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "--tests" && index + 1 < tokens.length) {
      tests.push(tokens[index + 1]);
      index += 1;
    } else base.push(tokens[index]);
  }
  return { base: base.join(" "), tests };
}

export function acceptanceTotals(contract: Pick<AcceptanceContract, "criteria"> | null | undefined, jobs: VerificationJob[] = []) {
  const totals = { total: 0, proven: 0, unproven: 0, failed: 0, notApplicable: 0, ran: 0, running: 0, blocked: 0 };
  for (const criterion of contract?.criteria ?? []) {
    totals.total += 1;
    const status = effectiveCriterionStatus(criterion, jobs);
    if (status === "proven") totals.proven += 1;
    else if (status === "failed") totals.failed += 1;
    else if (status === "not-applicable") totals.notApplicable += 1;
    else totals.unproven += 1;
    const run = criterionRunState(criterion, jobs);
    if (run === "passed" && status === "proven") totals.ran += 1;
    if (run === "queued" || run === "running") totals.running += 1;
    if (run === "blocked") totals.blocked += 1;
  }
  return totals;
}
