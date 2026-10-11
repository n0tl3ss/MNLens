import type { AcceptanceContract, AnalysisResult, FeedbackCommentPreview, PrDetail, ReviewMemorySummary, VerificationJob } from "../shared/types.js";
import { contractTotals, effectiveStatus } from "./acceptance.js";
import { verdictKey } from "./reviewMemory.js";

/**
 * Author feedback comment.
 *
 * Closes the loop with the PR author (human or agent): one structured,
 * human-approved comment that carries the acceptance-criteria status, the
 * findings the reviewer actually kept (dismissed ones are left out), the
 * second-opinion disputes, and the verification evidence. The reviewer sees
 * and edits the Markdown before anything is posted; MNLens never posts on
 * its own.
 */
export function buildFeedbackComment(args: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  contract?: AcceptanceContract;
  memory?: ReviewMemorySummary;
  verificationJobs?: VerificationJob[];
  reviewerNote?: string;
}): FeedbackCommentPreview {
  const sections: string[] = [];
  const lines: string[] = [];
  const { detail, analysis, contract, memory } = args;
  const verdicts = memory?.prVerdicts ?? {};
  const isDismissed = (kind: string, title: string) => verdicts[verdictKey(kind, title)] === "dismissed";

  lines.push(`## Review summary for #${detail.number}`);
  lines.push("");
  lines.push("_Prepared with MNLens and approved by the reviewer. Items below were checked by a human; dismissed AI suggestions are not included._");
  lines.push("");

  if (args.reviewerNote?.trim()) {
    sections.push("note");
    lines.push(args.reviewerNote.trim(), "");
  }

  if (contract && contract.criteria.length > 0) {
    sections.push("acceptance");
    const totals = contractTotals(contract);
    lines.push(`### Acceptance criteria — ${totals.proven}/${totals.total - totals.notApplicable} proven${totals.failed ? `, ${totals.failed} failed` : ""}${totals.unproven ? `, ${totals.unproven} unproven` : ""}`);
    lines.push("");
    lines.push("| Status | Criterion | Evidence |");
    lines.push("| --- | --- | --- |");
    for (const criterion of contract.criteria) {
      const status = effectiveStatus(criterion);
      const icon = status === "proven" ? "✅" : status === "failed" ? "❌" : status === "not-applicable" ? "➖" : "⚠️";
      const evidence = criterion.evidence.map((item) => `${item.kind}: \`${item.ref}\``).join("<br>") || (criterion.humanNote ?? criterion.note ?? "");
      lines.push(`| ${icon} ${status} | ${escapeCell(criterion.text)}${criterion.origin ? ` _(${escapeCell(criterion.origin)})_` : ""} | ${escapeCell(evidence)} |`);
    }
    lines.push("");
    const unproven = contract.criteria.filter((criterion) => effectiveStatus(criterion) === "unproven");
    if (unproven.length > 0) {
      lines.push("**To make this mergeable:**");
      for (const criterion of unproven) lines.push(`- ${criterion.text}${criterion.note ? ` — ${criterion.note}` : ""}`);
      lines.push("");
    }
  }

  const risks = (analysis?.riskDetails ?? []).filter((risk) => !isDismissed("risk", risk.title));
  const focus = (analysis?.reviewerFocusDetails ?? []).filter((item) => !isDismissed("focus", item.title));
  if (risks.length > 0 || focus.length > 0) {
    sections.push("findings");
    lines.push("### Findings");
    lines.push("");
    for (const risk of risks) lines.push(`- **${severityTag(risk.severity)} ${risk.title}** — ${risk.observation}${risk.recommendation ? ` _Suggested:_ ${risk.recommendation}` : ""}`);
    for (const item of focus) lines.push(`- **${item.title}** — ${item.observation}${item.recommendation ? ` _Suggested:_ ${item.recommendation}` : ""}`);
    lines.push("");
  }

  if (analysis?.secondOpinion && (analysis.secondOpinion.disputed.length > 0 || analysis.secondOpinion.missed.length > 0)) {
    sections.push("second-opinion");
    lines.push("### Second-opinion notes");
    lines.push("");
    for (const item of analysis.secondOpinion.missed) lines.push(`- ${severityTag(item.severity)} ${item.title} — ${item.observation}`);
    for (const item of analysis.secondOpinion.disputed) lines.push(`- _Disputed finding:_ ${item.item} — ${item.reason}`);
    lines.push("");
  }

  const verification = (args.verificationJobs ?? []).filter((job) => job.status === "done" || job.status === "failed").slice(0, 8);
  if (verification.length > 0) {
    sections.push("verification");
    lines.push("### Verification run locally by the reviewer");
    lines.push("");
    for (const job of verification) lines.push(`- ${job.status === "done" ? "✅" : "❌"} \`${job.command}\`${job.durationMs ? ` (${Math.round(job.durationMs / 1000)}s)` : ""}`);
    lines.push("");
  }

  if (analysis?.testAssessment && analysis.testAssessment.gaps.length > 0) {
    sections.push("tests");
    lines.push("### Test gaps");
    lines.push("");
    for (const gap of analysis.testAssessment.gaps.slice(0, 6)) lines.push(`- ${gap}`);
    lines.push("");
  }

  return { body: lines.join("\n").trim() + "\n", sections };
}

function severityTag(severity: string): string {
  return severity === "high" ? "🔴" : severity === "medium" ? "🟠" : severity === "low" ? "🟡" : "ℹ️";
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}
