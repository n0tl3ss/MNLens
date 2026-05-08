import type { AnalysisResult, FixJob, PrDetail, ReviewInsight, SourceLink, VerificationJob } from "../../../shared/types";
import type { DraftReviewComment } from "./CommentTab";
import { Badge, plural } from "./uiBits";

type ReviewTraceItem = {
  kind: string;
  title: string;
  body: string;
  target?: string;
  tone: "danger" | "queue" | "feature" | "added" | "neutral";
};

export function ReviewTraceSection({
  detail,
  analysis,
  reviewComments,
  verificationJobs,
  fixJobs,
  compact = false
}: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  reviewComments: DraftReviewComment[];
  verificationJobs: VerificationJob[];
  fixJobs: FixJob[];
  compact?: boolean;
}) {
  const trace = buildReviewTrace(detail, analysis, reviewComments, verificationJobs, fixJobs);
  const visible = compact ? trace.slice(0, 4) : trace;
  return (
    <section className="summary-card review-trace-card">
      <div className="panel-title">
        <div>
          <h3>Review Trace</h3>
          <p className="muted">Connects findings to files, research, comments, verification, and Codex work.</p>
        </div>
        <Badge tone={trace.some((item) => item.tone === "danger") ? "danger" : trace.some((item) => item.tone === "queue") ? "queue" : "neutral"}>
          {plural(trace.length, "link")}
        </Badge>
      </div>
      <div className="review-trace-list">
        {visible.map((item) => (
          <article key={`${item.kind}-${item.title}-${item.target}`} className={item.tone}>
            <span>
              <Badge tone={item.tone}>{item.kind}</Badge>
              {item.target && <em>{item.target}</em>}
            </span>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
      {trace.length > visible.length && <p className="muted">+{trace.length - visible.length} more trace links in the full review context.</p>}
    </section>
  );
}

function buildReviewTrace(
  detail: PrDetail,
  analysis: AnalysisResult | undefined,
  reviewComments: DraftReviewComment[],
  verificationJobs: VerificationJob[],
  fixJobs: FixJob[]
): ReviewTraceItem[] {
  const items: ReviewTraceItem[] = [];
  const changedPaths = new Set(detail.files.map((file) => file.path));
  for (const risk of sortReviewInsights(analysis?.riskDetails ?? []).slice(0, 4)) {
    const file = bestFileForText(detail, `${risk.title} ${risk.observation} ${risk.perspective} ${risk.recommendation}`);
    items.push({
      kind: "Risk",
      title: risk.title || "Review risk",
      body: risk.recommendation || risk.perspective || risk.observation,
      target: file?.path,
      tone: toneForSeverity(risk.severity) === "danger" ? "danger" : "queue"
    });
  }
  for (const comment of reviewComments.filter((comment) => comment.body.trim()).slice(0, 4)) {
    items.push({
      kind: "Draft comment",
      title: comment.path,
      body: compactText(comment.body, 180),
      target: `${comment.path}:${comment.line}`,
      tone: "queue"
    });
  }
  const latestVerification = [...verificationJobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  for (const job of latestVerification) {
    items.push({
      kind: "Verification",
      title: job.statusMessage ?? job.command,
      body: job.status === "done" ? "Local evidence is available for this review item." : job.error || job.command,
      target: job.repoDir,
      tone: job.status === "failed" ? "danger" : job.status === "done" ? "added" : "queue"
    });
  }
  const latestFix = [...fixJobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (latestFix) {
    items.push({
      kind: "Codex",
      title: latestFix.status === "done" ? "Prepared fix session" : "Active fix session",
      body: latestFix.statusMessage || latestFix.instructions || "Codex fix session exists for this PR.",
      target: latestFix.source ?? latestFix.repoDir,
      tone: latestFix.status === "failed" ? "danger" : latestFix.status === "done" ? "added" : "queue"
    });
  }
  for (const source of [...(analysis?.similarImplementations ?? []), ...(analysis?.docs ?? [])].slice(0, 3)) {
    items.push({
      kind: "Research",
      title: source.title || source.repository || "Research source",
      body: source.comparison || source.reason || "Research source collected for this PR.",
      target: source.repository || source.framework,
      tone: researchRelevance(source, detail, analysis).tone
    });
  }
  if (changedPaths.size > 0 && items.length === 0) {
    items.push({
      kind: "Files",
      title: plural(changedPaths.size, "changed file"),
      body: "Run analysis to connect files with risks, verification, research, and review comments.",
      tone: "neutral"
    });
  }
  return items.slice(0, 14);
}

function bestFileForText(detail: PrDetail, text: string): PrDetail["files"][number] | undefined {
  const lower = text.toLowerCase();
  return detail.files.find((file) => lower.includes(file.path.toLowerCase())) ?? detail.files.find((file) => lower.includes(file.path.split("/").at(-1)?.toLowerCase() ?? ""));
}

function researchRelevance(source: SourceLink, detail?: PrDetail, analysis?: AnalysisResult): { label: string; reason: string; tone: "danger" | "queue" | "feature" | "added" | "neutral" } {
  const text = `${source.title} ${source.reason} ${source.comparison} ${source.codeSnippet} ${source.repository} ${source.filePath}`.toLowerCase();
  const prText = `${detail?.title ?? ""} ${analysis?.summary ?? ""} ${detail?.files.map((file) => file.path).join(" ") ?? ""}`.toLowerCase();
  if (source.codeSnippet && anySharedDomainTerm(text, prText)) {
    return { label: "Direct", reason: "Contains concrete code or docs that match APIs, files, or behavior in this PR.", tone: "added" };
  }
  if (anySharedDomainTerm(text, prText)) {
    return { label: "Partial", reason: "Relevant to the same ecosystem or behavior, but it still needs comparison against the actual PR diff.", tone: "feature" };
  }
  if (/official|docs|documentation|maven central|github\.com\/[^/]+\/[^/]+/.test(text)) {
    return { label: "Background", reason: "Useful as authority/background, but not enough by itself to prove this implementation is correct.", tone: "neutral" };
  }
  return { label: "Check relevance", reason: "This source may be noise unless it directly supports a review point.", tone: "queue" };
}

function sortReviewInsights(items: ReviewInsight[]): ReviewInsight[] {
  const order: Record<ReviewInsight["severity"], number> = { high: 0, medium: 1, low: 2, info: 3 };
  return [...items].sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title));
}

function anySharedDomainTerm(left: string, right: string): boolean {
  const terms = ["oracle", "ucp", "opentelemetry", "logging", "logid", "jdbc", "bom", "micronaut", "gradle", "maven", "bean", "lifecycle", "metrics", "tracing"];
  return terms.some((term) => left.includes(term) && right.includes(term));
}

function compactText(value: string, limit = 140): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text || "No body.";
}

function toneForSeverity(severity?: string): string {
  if (severity === "high") return "danger";
  if (severity === "medium") return "queue";
  if (severity === "low") return "improvement";
  return "neutral";
}
