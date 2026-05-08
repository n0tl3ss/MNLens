import type { FixJob, Job, JobStatus, VerificationJob } from "../shared/types.js";

export type RecoverableJob = Job | VerificationJob | FixJob;

export function isActiveStatus(status: JobStatus): boolean {
  return status === "queued" || status === "running";
}

export function interruptedJobPatch<T extends RecoverableJob>(
  job: T,
  message: string,
  patch: Partial<T> = {}
): Partial<T> {
  const now = new Date().toISOString();
  return {
    ...patch,
    status: "failed",
    interruptedAt: job.interruptedAt ?? now,
    resumable: true,
    recoveryMessage: message,
    error: [message, job.error].filter(Boolean).join("\n\n") || undefined,
    updatedAt: now
  } as Partial<T>;
}

export function clearRecoveryPatch<T extends RecoverableJob>(): Partial<T> {
  return {
    interruptedAt: undefined,
    resumable: undefined,
    recoveryMessage: undefined
  } as Partial<T>;
}

export function parsePrKey(key: string): { owner: string; repo: string; number: number } | undefined {
  const [owner, repo, numberText] = key.split("__");
  const number = Number(numberText);
  if (!owner || !repo || !Number.isFinite(number)) return undefined;
  return { owner, repo, number };
}
