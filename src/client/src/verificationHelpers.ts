import type { CiCheck, ManualVerificationResult, ReviewProgress, VerificationJob } from "../../shared/types";

export function extractRunnableCommand(text: string): string | undefined {
  let trimmed = text.trim();
  const fenced = /```(?:\w+)?\s*([\s\S]*?)\s*```/.exec(trimmed);
  if (fenced) trimmed = fenced[1].trim();
  const inline = /`([^`]+)`/.exec(trimmed);
  if (inline) trimmed = inline[1].trim();
  const commandMatch = /((?:\.\/)?(?:gradlew|mvnw)\b[^\n]*|(?:gradle|mvn|npm|pnpm|yarn|make|go|cargo)\b[^\n]*)/.exec(trimmed);
  return commandMatch?.[1].replace(/[.)\]]+$/g, "").trim();
}

export function ciCoverageForCommand(command: string, checks: CiCheck[]): { label: string; detail: string; bucket: string } | undefined {
  if (checks.length === 0) return undefined;
  const text = commandKey(command).toLowerCase();
  const specificToken = text
    .split(/\s+/)
    .find((part) => part.includes(":") || part.includes("test-suite") || part.includes("test"));
  const specific = specificToken
    ? checks.find((check) => `${check.name} ${check.workflow} ${check.description}`.toLowerCase().includes(specificToken.toLowerCase()))
    : undefined;
  const general = checks.find((check) => /test|build|java|gradle/i.test(`${check.name} ${check.workflow}`));
  const check = specific ?? general;
  if (!check) return undefined;
  return {
    label: specific ? `${check.state} in ${check.name}` : `${check.state} in general CI`,
    detail: specific ? "This command appears to be covered by a matching CI check." : "No exact command match found, but the PR build/test CI ran.",
    bucket: check.bucket || "neutral"
  };
}

export function ciSummary(checks: CiCheck[]): { label: string; tone: string } {
  if (checks.length === 0) return { label: "unknown", tone: "neutral" };
  if (checks.some((check) => check.bucket === "fail" || /fail|error|cancel/i.test(check.state))) return { label: "failing", tone: "danger" };
  if (checks.some((check) => check.bucket === "pending" || /pending|queued|in_progress/i.test(check.state))) return { label: "running", tone: "queue" };
  if (checks.every((check) => check.bucket === "pass" || check.state === "SUCCESS")) return { label: "passing", tone: "added" };
  return { label: "mixed", tone: "neutral" };
}

export function usableCheckTime(check: CiCheck): string {
  return [check.completedAt, check.startedAt].find((value) => value && !value.startsWith("0001-")) ?? "";
}

export function toneForCi(check: CiCheck): string {
  if (check.bucket === "pass" || check.state === "SUCCESS") return "added";
  if (check.bucket === "fail" || /fail|error|cancel/i.test(check.state)) return "danger";
  if (check.bucket === "pending" || /pending|queued|in_progress/i.test(check.state)) return "queue";
  return "neutral";
}

export function isVulnerabilityAuditCheck(check: CiCheck): boolean {
  const text = `${check.name} ${check.workflow} ${check.description}`.toLowerCase();
  return text.includes("vulnerab") || text.includes("cve") || text.includes("audit");
}

export function sortVerificationItems(
  items: string[],
  jobs: VerificationJob[],
  progress?: ReviewProgress
): Array<{ item: string; originalIndex: number }> {
  const latestByCommand = new Map<string, VerificationJob>();
  for (const job of [...jobs].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    latestByCommand.set(commandKey(job.command), job);
  }
  return items
    .map((item, originalIndex) => {
      const command = extractRunnableCommand(item);
      const manualId = manualCheckId(item, originalIndex);
      const job = command
        ? latestByCommand.get(commandKey(command))
        : latestByCommand.get(commandKey(manualVerificationCommand(manualId)));
      const manualStatus = progress?.manualChecks?.[manualId]?.status;
      return { item, originalIndex, priority: verificationPriority(item, command, job, manualStatus) };
    })
    .sort((a, b) => b.priority - a.priority || a.originalIndex - b.originalIndex)
    .map(({ item, originalIndex }) => ({ item, originalIndex }));
}

export function sortCiChecks(checks: CiCheck[]): CiCheck[] {
  return checks
    .map((check, index) => ({ check, index }))
    .sort((a, b) => ciPriority(b.check) - ciPriority(a.check) || a.index - b.index)
    .map(({ check }) => check);
}

export function isGenuineManualVerification(item: string): boolean {
  const text = item.toLowerCase();
  if (isDocRenderVerificationItem(item)) return true;
  if (/manual verification\s*:/.test(text)) return true;
  return /\b(real cloud|cloud account|credentials?|secret|token|paid service|external service|oracle cloud|aws|azure|gcp|oci|otlp endpoint|release permission|browser|visual|screenshot|human judgment|cannot be automated)\b/.test(text);
}

export function isAutomationVerificationCandidate(item: string): boolean {
  return !extractRunnableCommand(item) && !isGenuineManualVerification(item);
}

export function isDocRenderVerificationItem(item: string): boolean {
  const text = item.toLowerCase();
  return /\b(build|render|screenshot|html|site)\b/.test(text) && /\b(docs?|documentation|asciidoc|adoc|guide)\b/.test(text);
}

export function automationReason(item: string): string {
  const text = item.toLowerCase();
  if (/\btck\b/.test(text)) return "This reads like contract coverage and should usually live in a reusable TCK or integration test.";
  if (/\bintegration|instrumentation|telemetry|database|messaging|lifecycle|bean|edge case\b/.test(text)) {
    return "This is an integration behavior. The app treats it as something Codex should help turn into runnable coverage.";
  }
  return "No runnable command was detected, but this does not look genuinely manual.";
}

export function commandKey(command: string): string {
  return command
    .trim()
    .replace(/[`"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.)\]]+$/g, "")
    .trim();
}

export function manualCheckId(item: string, index: number): string {
  let hash = 0;
  for (const char of item) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `manual:${index}:${hash.toString(16)}`;
}

export function manualVerificationCommand(id: string): string {
  return `codex-manual-check ${id}`;
}

export function cleanConsoleOutput(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .trimEnd();
}

export function verificationProgress(phase?: VerificationJob["phase"]): string {
  if (phase === "preparing") return "20%";
  if (phase === "cloning") return "40%";
  if (phase === "checking-out") return "60%";
  if (phase === "running") return "80%";
  if (phase === "completed") return "100%";
  return "10%";
}

function verificationPriority(item: string, command?: string, job?: VerificationJob, manualStatus?: ManualVerificationResult["status"]): number {
  if (job?.status === "failed" || manualStatus === "failed") return 6;
  if (isDocRenderVerificationItem(item) && job?.status !== "done" && manualStatus !== "passed") return 5.5;
  if (textPriority(item) >= 4) return 5;
  if (job?.status === "queued" || job?.status === "running") return 4;
  if (command && !job) return 3;
  if (!command && !manualStatus) return 2;
  if (job?.status === "done" || manualStatus === "passed") return 1;
  return 0;
}

function ciPriority(check: CiCheck): number {
  if (check.bucket === "fail" || /fail|error|cancel/i.test(check.state)) return 4;
  if (check.bucket === "pending" || /pending|queued|in_progress/i.test(check.state)) return 3;
  if (check.bucket === "pass" || check.state === "SUCCESS") return 1;
  return 2;
}

function textPriority(item: string): number {
  const text = item.toLowerCase();
  if (/\b(block|blocker|fail|failure|failed|missing|gap|risk|leak|duplicate|regression|security|unsafe|not covered|no test|do not approve)\b/.test(text)) return 4;
  if (/\b(verify|confirm|check|ensure|assert|coverage|edge case|should|must|needs|manual)\b/.test(text)) return 3;
  if (/\b(docs?|documentation|note|sample|example|style)\b/.test(text)) return 2;
  return 1;
}
