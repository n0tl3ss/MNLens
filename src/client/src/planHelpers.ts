import type { AnalysisResult, PrDetail, ReviewComment, ReviewInsight, ReviewProgress } from "../../shared/types";
import { extractFileDiff, type OverviewLinePin } from "./components/DiffViewer";

export type PlanFileSignal = {
  kind: "risk" | "focus" | "evidence" | "test";
  title: string;
  body: string;
  recommendation?: string;
  severity?: ReviewInsight["severity"];
  tone: "danger" | "queue" | "feature" | "added";
};

export function buildReviewChecklist(detail: PrDetail, analysis?: AnalysisResult) {
  const base = [
    { id: "understand-change", title: "Understand the intended change", detail: analysis?.summary ?? detail.title },
    { id: "inspect-risk", title: "Inspect high-risk behavior", detail: analysis?.risks[0] ?? "Check changed production paths and lifecycle effects." },
    { id: "verify-tests", title: "Verify test coverage", detail: analysis?.testsToCheck[0] ?? "Confirm tests cover the behavior changed by this PR." }
  ];
  return [
    ...base,
    ...(analysis?.reviewerFocus ?? []).slice(0, 5).map((detail, index) => ({ id: `focus-${index}`, title: "Reviewer focus", detail }))
  ];
}

export function isReviewPlanComplete(detail: PrDetail, analysis: AnalysisResult | undefined, progress: ReviewProgress | undefined): boolean {
  if (!progress) return false;
  const checked = new Set(progress.checkedItems);
  const reviewed = new Set(progress.reviewedFiles);
  const checklist = buildReviewChecklist(detail, analysis).slice(0, 3);
  return checklist.every((item) => checked.has(item.id)) && detail.files.every((file) => reviewed.has(file.path));
}

export function submitReviewLabel(commentsCount: number, canApproveWithoutComments: boolean): string {
  if (commentsCount > 0) return `Submit review (${commentsCount})`;
  return canApproveWithoutComments ? "Submit approval" : "Submit review";
}

export function rankFiles(detail: PrDetail, analysis?: AnalysisResult) {
  const focusText = `${analysis?.reviewerFocus.join(" ") ?? ""} ${analysis?.risks.join(" ") ?? ""}`.toLowerCase();
  return [...detail.files]
    .sort((a, b) => {
      const groupA = isTestOrSupportFile(a.path) ? 1 : 0;
      const groupB = isTestOrSupportFile(b.path) ? 1 : 0;
      return groupA - groupB || b.additions + b.deletions - (a.additions + a.deletions);
    })
    .map((file) => ({
      ...file,
      reason: focusText.includes(file.path.toLowerCase())
        ? "Mentioned in AI focus areas."
        : file.additions + file.deletions > 80
          ? "Large change; inspect early."
          : file.path.includes("test")
            ? "Test coverage or test setup."
            : "Changed file."
    }));
}

export function isTestOrSupportFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.includes("test-suite") ||
    lower.endsWith(".adoc") ||
    lower.endsWith(".md") ||
    lower.includes("build.gradle") ||
    lower.includes("pom.xml") ||
    lower.includes("gradle/")
  );
}

export function buildFileReviewSignals(file: PrDetail["files"][number], analysis: AnalysisResult | undefined, diff: string): PlanFileSignal[] {
  if (!analysis) return [];
  const signals: PlanFileSignal[] = [];
  const fileDiff = extractFileDiff(diff, file.path);
  const risks = relevantInsights(file.path, analysis.riskDetails ?? [], fileDiff);
  const focus = relevantInsights(file.path, analysis.reviewerFocusDetails ?? [], fileDiff);
  const evidence = relevantInsights(file.path, analysis.evidenceDetails ?? [], fileDiff);

  for (const item of risks.slice(0, 3)) {
    signals.push({
      kind: "risk",
      title: item.title || "Risk",
      body: item.perspective || item.observation,
      recommendation: item.recommendation,
      severity: item.severity,
      tone: toneForSeverity(item.severity) === "danger" ? "danger" : "queue"
    });
  }
  for (const item of focus.slice(0, 3)) {
    signals.push({
      kind: "focus",
      title: item.title || "Reviewer focus",
      body: item.perspective || item.observation,
      recommendation: item.recommendation,
      severity: item.severity,
      tone: toneForSeverity(item.severity) === "danger" ? "danger" : "queue"
    });
  }
  for (const item of evidence.slice(0, 2)) {
    signals.push({
      kind: "evidence",
      title: item.title || "Evidence",
      body: item.observation,
      recommendation: item.recommendation,
      severity: item.severity,
      tone: "feature"
    });
  }
  const testSignal = relevantTextForFile(file.path, analysis.testsToCheck);
  if (testSignal) signals.push({ kind: "test", title: "Verification", body: testSignal, tone: "added" });
  return dedupePlanSignals(signals).slice(0, 7);
}

export function buildOverviewLinePins(file: PrDetail["files"][number], analysis: AnalysisResult | undefined, diff: string): OverviewLinePin[] {
  if (!analysis) return [];
  const signals = buildFileReviewSignals(file, analysis, diff);
  const fileDiff = extractFileDiff(diff, file.path);
  const usedTargets = new Set<string>();
  const pins: OverviewLinePin[] = [];
  for (const signal of signals) {
    const target = findBestSignalTarget(fileDiff, file.path, signal);
    if (!target) continue;
    const key = `${target.path}:${target.side}:${target.line}`;
    if (usedTargets.has(key)) continue;
    usedTargets.add(key);
    pins.push({
      target,
      kind: signal.kind,
      title: signal.title,
      body: signal.body,
      recommendation: signal.recommendation,
      severity: signal.severity,
      tone: signal.tone,
      draftBody: authorCommentForSignal(signal)
    });
  }
  return pins.slice(0, 5);
}

export function authorCommentForSignal(signal: PlanFileSignal): string {
  const text = signal.recommendation || signal.body;
  if (/test|coverage|verify|assert/i.test(text)) return `Could you add or point me to test coverage for this? ${text}`;
  if (/doc|document|guide|readme/i.test(text)) return `Could you clarify this in the docs or PR description? ${text}`;
  return `Could you address or clarify this review concern? ${text}`;
}

function relevantInsights(path: string, insights: ReviewInsight[], fileDiff: string): ReviewInsight[] {
  return sortReviewInsights(insights).filter((item) => isInsightRelevantToFile(path, item, fileDiff));
}

function relevantTextForFile(path: string, items: string[]): string | undefined {
  const tokens = fileReferenceTokens(path);
  return items.find((item) => tokens.some((token) => item.toLowerCase().includes(token)));
}

function isInsightRelevantToFile(path: string, item: ReviewInsight, fileDiff = ""): boolean {
  const text = `${item.title} ${item.observation} ${item.perspective} ${item.recommendation}`.toLowerCase();
  const explicitlyReferencesFile = fileReferenceTokens(path).some((token) => token.length >= 4 && text.includes(token));
  if (explicitlyReferencesFile) return true;
  if (isTestOrSupportFile(path) && !isSupportFileInsight(text)) return false;
  const changedText = changedDiffText(fileDiff).toLowerCase();
  if (!changedText) return false;
  return meaningfulTokens(text).some((token) => changedText.includes(token));
}

function fileReferenceTokens(path: string): string[] {
  const lower = path.toLowerCase();
  const file = lower.split("/").at(-1) ?? lower;
  const stem = file.replace(/\.[^.]+$/, "");
  return [...new Set([lower, file, stem, ...stem.split(/[-_.]/), ...lower.split("/").slice(-3)])].filter(Boolean);
}

function changedDiffText(fileDiff: string): string {
  return fileDiff
    .split("\n")
    .filter((line) => line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))
    .filter((line) => !line.startsWith("+++") && !line.startsWith("---"))
    .map((line) => line.slice(1))
    .join("\n");
}

function meaningfulTokens(text: string): string[] {
  const stop = new Set(["about", "after", "before", "because", "check", "could", "current", "default", "expected", "implementation", "missing", "review", "should", "source", "tests", "there", "this", "with", "without"]);
  return [...new Set(text.toLowerCase().split(/[^a-z0-9_$.]+/).filter((token) => token.length >= 5 && !stop.has(token)))].slice(0, 20);
}

function findBestSignalTarget(fileDiff: string, path: string, signal: PlanFileSignal): Omit<ReviewComment, "body"> | undefined {
  const candidates = diffLineCandidates(fileDiff, path);
  if (candidates.length === 0) return undefined;
  const tokens = meaningfulTokens(`${signal.title} ${signal.body} ${signal.recommendation ?? ""}`);
  const usefulCandidates = candidates.filter((candidate) => isUsefulPinCandidate(candidate.text, path, signal));
  if (usefulCandidates.length === 0) return undefined;
  const scored = candidates
    .filter((candidate) => usefulCandidates.includes(candidate))
    .map((candidate) => ({ candidate, score: scorePinCandidate(candidate, tokens, path, signal) }))
    .sort((a, b) => b.score - a.score);
  return scored.find((item) => item.score >= 1)?.candidate.target;
}

type DiffLineCandidate = {
  target: Omit<ReviewComment, "body">;
  text: string;
  kind: "add" | "remove" | "context";
};

function diffLineCandidates(fileDiff: string, path: string): DiffLineCandidate[] {
  const lines = fileDiff.split("\n");
  const candidates: DiffLineCandidate[] = [];
  let oldLine = 0;
  let newLine = 0;
  let currentPath = "";
  let oldPath = "";
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      currentPath = "";
      oldPath = "";
      continue;
    }
    if (line.startsWith("--- ")) {
      oldPath = normalizeDiffPath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      currentPath = normalizeDiffPath(line.slice(4)) || oldPath || path;
      continue;
    }
    if (line.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldLine = match ? Number(match[1]) : oldLine;
      newLine = match ? Number(match[2]) : newLine;
      continue;
    }
    if (!currentPath) continue;
    const kind = diffLineKind(line);
    if (kind === "add") {
      candidates.push({ target: { path: currentPath, line: newLine, side: "RIGHT" }, text: line.slice(1), kind });
      newLine += 1;
    } else if (kind === "remove") {
      candidates.push({ target: { path: oldPath || currentPath, line: oldLine, side: "LEFT" }, text: line.slice(1), kind });
      oldLine += 1;
    } else if (kind === "context") {
      const text = line.startsWith(" ") ? line.slice(1) : line;
      candidates.push({ target: { path: currentPath, line: newLine, side: "RIGHT" }, text, kind });
      oldLine += 1;
      newLine += 1;
    }
  }
  return candidates.filter((candidate) => candidate.text.trim().length > 0);
}

function isSupportFileInsight(text: string): boolean {
  return /\b(test|coverage|docs?|documentation|dependency|version|bom|gradle|maven|pom|build|ci|verification|example)\b/i.test(text);
}

function isUsefulPinCandidate(text: string, path: string, signal: PlanFileSignal): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^[{}()[\],;]*$/.test(trimmed)) return false;
  if (isImportOrPackageLine(trimmed) && !isImportRelatedSignal(signal)) return false;
  if (isTestOrSupportFile(path) && !isSupportFileInsight(`${signal.title} ${signal.body} ${signal.recommendation ?? ""}`)) return false;
  if (isTestOrSupportFile(path) && !isSupportLineForSignal(trimmed, signal)) return false;
  return true;
}

function scorePinCandidate(candidate: DiffLineCandidate, tokens: string[], path: string, signal: PlanFileSignal): number {
  let score = 0;
  const text = candidate.text.toLowerCase();
  for (const token of tokens) if (text.includes(token)) score += 2;
  if (candidate.kind === "add") score += 1.25;
  if (candidate.kind === "remove") score += 0.25;
  if (isImportOrPackageLine(candidate.text) && !isImportRelatedSignal(signal)) score -= 4;
  if (isTestOrSupportFile(path) && !isSupportLineForSignal(candidate.text, signal)) score -= 1;
  if (candidate.text.trim().length < 8) score -= 1;
  return score;
}

function isImportOrPackageLine(text: string): boolean {
  return /^\s*(import|package)\b/.test(text) || /^\s*#include\b/.test(text);
}

function isImportRelatedSignal(signal: PlanFileSignal): boolean {
  return /\b(import|package|unused|classpath|dependency|artifact)\b/i.test(`${signal.title} ${signal.body} ${signal.recommendation ?? ""}`);
}

function isSupportLineForSignal(line: string, signal: PlanFileSignal): boolean {
  const signalText = `${signal.title} ${signal.body} ${signal.recommendation ?? ""}`.toLowerCase();
  const lineText = line.toLowerCase();
  if (/\b(dependenc|version|bom|artifact|library|gradle|maven|classpath|module)\b/i.test(signalText)) {
    return /\b(version|dependency|api|implementation|compileonly|runtimeonly|libs\.|mn\w*\.|bom|artifact|id\s*\(|include\(|micronaut)\b/i.test(lineText);
  }
  if (/\b(docs?|documentation|guide|readme)\b/i.test(signalText)) {
    return /\.(adoc|md|rst|txt)\b/i.test(lineText) || /\b(doc|guide|readme|include::|xref:|link:)\b/i.test(lineText);
  }
  if (/\b(test|coverage|spec|verification)\b/i.test(signalText)) {
    return /\b(test|spec|assert|expect|verify|should|given|when|then)\b/i.test(lineText);
  }
  return true;
}

function dedupePlanSignals(signals: PlanFileSignal[]): PlanFileSignal[] {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.kind}:${signal.title}:${signal.body}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeDiffPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") return "";
  return trimmed.replace(/^a\//, "").replace(/^b\//, "");
}

function diffLineKind(line: string): "add" | "remove" | "hunk" | "meta" | "context" {
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("From ") ||
    line.startsWith("From: ") ||
    line.startsWith("Date: ") ||
    line.startsWith("Subject: ") ||
    line.startsWith("Co-Authored-By: ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("create mode ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    /^\s+\d+ files? changed/.test(line) ||
    /^\s+\d+ file changed/.test(line)
  ) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}

function toneForSeverity(severity?: string): string {
  if (severity === "high") return "danger";
  if (severity === "medium") return "queue";
  if (severity === "low") return "improvement";
  return "neutral";
}

function sortReviewInsights<T extends Partial<ReviewInsight>>(items: T[]): T[] {
  return [...items].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(severity?: string): number {
  if (severity === "high") return 4;
  if (severity === "medium") return 3;
  if (severity === "low") return 2;
  if (severity === "info") return 1;
  return 0;
}
