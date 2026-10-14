import type { AcceptanceContract, AcceptanceCriterion, CriterionStatus, VerificationJob } from "./types.js";

/**
 * Effective status of an acceptance criterion, shared by server and client.
 *
 * Precedence: the reviewer's override, then a failed local run of the command
 * that exercises the criterion, then the agent's verdict. A green run does not
 * upgrade "unproven" to "proven" on its own: proven requires a test that encodes
 * the criterion (the agent's evidence) *and* that test passing.
 */
export function effectiveCriterionStatus(criterion: Pick<AcceptanceCriterion, "status" | "humanStatus" | "verification">, jobs: VerificationJob[] = []): CriterionStatus {
  if (criterion.humanStatus) return criterion.humanStatus;
  if (criterionRunState(criterion, jobs) === "failed") return "failed";
  return criterion.status;
}

export type CriterionRunState = "queued" | "running" | "passed" | "failed";

/** State of the local verification run attached to a criterion, if any. */
export function criterionRunState(criterion: Pick<AcceptanceCriterion, "verification">, jobs: VerificationJob[] = []): CriterionRunState | undefined {
  const jobId = criterion.verification?.jobId;
  if (!jobId) return undefined;
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (!job) return undefined;
  if (job.status === "queued") return "queued";
  if (job.status === "running") return "running";
  if (job.status === "failed" || (typeof job.exitCode === "number" && job.exitCode !== 0)) return "failed";
  return "passed";
}

export function acceptanceTotals(contract: Pick<AcceptanceContract, "criteria"> | null | undefined, jobs: VerificationJob[] = []) {
  const totals = { total: 0, proven: 0, unproven: 0, failed: 0, notApplicable: 0, ran: 0, running: 0 };
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
  }
  return totals;
}
