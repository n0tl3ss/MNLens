import { FileSearch, Loader2, MessageSquare, Search, ShieldAlert, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AnalysisResult, PrDetail, SourceLink } from "../../../shared/types";
import { askResearch } from "../api";
import { Badge, plural } from "./uiBits";
import "./researchTab.css";

export function ResearchTab({
  detail,
  analysis,
  onStartFix
}: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  onStartFix: (instructions?: string, baseJobId?: string, source?: string) => void;
}) {
  const compact = isSimplePr(detail, analysis);
  return (
    <div className="panel research-layout">
      <ResearchGapsSection detail={detail} analysis={analysis} />
      <div className="research-column">
        <SourceSection title="Docs" icon={<FileSearch size={18} />} sources={analysis?.docs ?? []} compact={compact} detail={detail} analysis={analysis} />
        <CaveatsSection caveats={analysis?.caveats ?? []} compact={compact} />
      </div>
      <div className="research-column">
        <SourceSection
          title="Similar Implementations"
          icon={<Search size={18} />}
          sources={analysis?.similarImplementations ?? []}
          compact={compact}
          detail={detail}
          analysis={analysis}
          onStartFix={onStartFix}
          rich
        />
      </div>
    </div>
  );
}

function ResearchGapsSection({ detail, analysis }: { detail: PrDetail; analysis?: AnalysisResult }) {
  const gaps = researchGaps(detail, analysis);
  return (
    <section className="summary-card research-gaps-card">
      <div className="panel-title">
        <div>
          <h3>Research Gaps</h3>
          <p className="muted">What the current research does not yet prove.</p>
        </div>
        <Badge tone={gaps.some((gap) => gap.tone === "danger") ? "danger" : gaps.some((gap) => gap.tone === "queue") ? "queue" : "added"}>
          {plural(gaps.length, "gap")}
        </Badge>
      </div>
      <div className="review-trace-list">
        {gaps.map((gap) => (
          <article key={gap.title} className={gap.tone}>
            <span>
              <Badge tone={gap.tone}>{gap.kind}</Badge>
            </span>
            <strong>{gap.title}</strong>
            <p>{gap.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function CaveatsSection({ caveats, compact }: { caveats: string[]; compact: boolean }) {
  const visible = compact ? caveats.slice(0, 2) : caveats;
  return (
    <section className="summary-card insight-card risk">
      <div className="insight-heading">
        <h3>Caveats</h3>
        <Badge tone="risk">{visible.length}</Badge>
      </div>
      {visible.length === 0 ? (
        <p className="muted">No caveats recorded.</p>
      ) : (
        <ul className="insight-list">
          {visible.map((item, index) => (
            <li key={`${item}-${index}`}>
              <p>{item}</p>
            </li>
          ))}
        </ul>
      )}
      {caveats.length > visible.length && <p className="muted">Showing the top {visible.length} caveats for this small PR.</p>}
    </section>
  );
}

function SourceSection({
  title,
  icon,
  sources,
  compact = false,
  rich = false,
  detail,
  analysis,
  onStartFix
}: {
  title: string;
  icon: ReactNode;
  sources: AnalysisResult["docs"];
  compact?: boolean;
  rich?: boolean;
  detail?: PrDetail;
  analysis?: AnalysisResult;
  onStartFix?: (instructions?: string, baseJobId?: string, source?: string) => void;
}) {
  const visible = compact ? sources.slice(0, 2) : sources;
  const [questions, setQuestions] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function askAboutSource(source: SourceLink, key: string, fallbackQuestion: string) {
    if (!detail) return;
    const question = (questions[key] || fallbackQuestion).trim();
    if (!question) return;
    setLoading((current) => ({ ...current, [key]: true }));
    setErrors((current) => ({ ...current, [key]: "" }));
    try {
      const response = await askResearch({
        owner: detail.owner,
        repo: detail.repo,
        number: detail.number,
        source,
        question
      });
      setAnswers((current) => ({ ...current, [key]: response.answer }));
      setQuestions((current) => ({ ...current, [key]: "" }));
    } catch (err) {
      setErrors((current) => ({ ...current, [key]: messageOf(err) }));
    } finally {
      setLoading((current) => ({ ...current, [key]: false }));
    }
  }

  return (
    <section className="summary-card">
      <div className="panel-title">
        <h3>{title}</h3>
        {icon}
      </div>
      {visible.length === 0 ? (
        <p className="muted">No sources found yet.</p>
      ) : (
        <ul className={rich ? "sources rich-sources" : "sources"}>
          {visible.map((source, index) => {
            const key = `${source.url || source.title}-${index}`;
            const relevance = researchRelevance(source, detail, analysis);
            return (
              <li key={key}>
                <div className="source-heading">
                  <div>
                    {source.url ? (
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title || source.url}
                      </a>
                    ) : (
                      <strong>{source.title}</strong>
                    )}
                    {rich && (
                      <div className="source-meta">
                        <Badge tone={relevance.tone}>{relevance.label}</Badge>
                        {sourceAuthority(source) && <Badge tone="neutral">{sourceAuthority(source)}</Badge>}
                        {source.framework && <span>{source.framework}</span>}
                        {source.repository && <span>{source.repository}</span>}
                        {source.filePath && <span>{source.filePath}</span>}
                      </div>
                    )}
                  </div>
                </div>
                {source.reason && <p>{source.reason}</p>}
                {rich && (
                  <div className="source-note">
                    <b>Why this matters</b>
                    <p>{relevance.reason}</p>
                  </div>
                )}
                {rich && source.codeSnippet && (
                  <>
                    <pre className="source-snippet">
                      <code>{source.codeSnippet}</code>
                    </pre>
                    {source.snippetSourceUrl && (
                      <a className="snippet-source-link" href={source.snippetSourceUrl} target="_blank" rel="noreferrer">
                        Open snippet source
                      </a>
                    )}
                  </>
                )}
                {rich && source.comparison && (
                  <div className="source-note">
                    <b>Compare with this PR</b>
                    <p>{source.comparison}</p>
                  </div>
                )}
                {rich && source.caveat && (
                  <div className="source-note caveat">
                    <b>Reviewer check</b>
                    <p>{source.caveat}</p>
                  </div>
                )}
                {detail && (
                  <div className="source-ask">
                    <textarea
                      value={questions[key] ?? ""}
                      onChange={(event) => setQuestions((current) => ({ ...current, [key]: event.target.value }))}
                      placeholder="Ask about this source, relevance, missing edge cases, or why it should/should not affect review."
                    />
                    <div>
                      <button
                        disabled={loading[key]}
                        onClick={() => void askAboutSource(source, key, "Explain how relevant this source is to this PR, what it proves, what it does not prove, and what I should inspect next.")}
                      >
                        {loading[key] ? <Loader2 size={14} className="spin" /> : <MessageSquare size={14} />}
                        Ask Codex
                      </button>
                      {rich && (
                        <>
                          <button disabled={loading[key]} onClick={() => void askAboutSource(source, key, "Compare this source side-by-side with the PR implementation. Focus on lifecycle, config names, edge cases, and tests.")}>
                            <Search size={14} />
                            Compare
                          </button>
                          <button disabled={loading[key]} onClick={() => void askAboutSource(source, key, "Find missing edge cases or tests this source suggests for this PR.")}>
                            <ShieldAlert size={14} />
                            Edge cases
                          </button>
                        </>
                      )}
                      {onStartFix && (
                        <button onClick={() => onStartFix(buildResearchFixInstructions(source), undefined, `Research / ${title} / ${index + 1}`)}>
                          <Sparkles size={14} />
                          Use with Codex
                        </button>
                      )}
                    </div>
                    {(answers[key] || errors[key]) && (
                      <div className={`source-answer markdown-body ${errors[key] ? "error-text" : ""}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{errors[key] || answers[key]}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {sources.length > visible.length && <p className="muted">Showing the top {visible.length} sources for this small PR.</p>}
    </section>
  );
}

function researchGaps(detail: PrDetail, analysis?: AnalysisResult): Array<{ kind: string; title: string; body: string; tone: string }> {
  if (!analysis) {
    return [{
      kind: "Missing",
      title: "Analysis not run",
      body: "Run analysis to collect docs, similar implementations, caveats, and source relevance.",
      tone: "queue"
    }];
  }
  const sources = [...analysis.similarImplementations, ...analysis.docs];
  const direct = sources.filter((source) => researchRelevance(source, detail, analysis).label === "Direct");
  const gaps: Array<{ kind: string; title: string; body: string; tone: string }> = [];
  if (analysis.type === "feature" && direct.length === 0) {
    gaps.push({
      kind: "Research",
      title: "No direct implementation match",
      body: "Research has not found a directly comparable implementation with code snippets. Treat framework docs as background, not proof.",
      tone: "queue"
    });
  }
  if (sources.length === 0) {
    gaps.push({
      kind: "Research",
      title: "No sources collected",
      body: "Use Reanalyze or ask Research questions before relying on external behavior assumptions.",
      tone: "queue"
    });
  }
  if ((analysis.caveats ?? []).length > 0) {
    gaps.push({
      kind: "Caveat",
      title: "Caveats still need human judgment",
      body: analysis.caveats[0],
      tone: "feature"
    });
  }
  const docsFiles = detail.files.filter((file) => isDocsPath(file.path));
  if (docsFiles.length > 0 && !analysis.testsToCheck.some((item) => isDocRenderVerificationItem(item))) {
    gaps.push({
      kind: "Docs",
      title: "Rendered docs not explicitly covered",
      body: "Docs changes should be verified by rendered output, not only source diff inspection.",
      tone: "queue"
    });
  }
  return gaps.length > 0 ? gaps : [{
    kind: "Ready",
    title: "Research is enough for review",
    body: "The collected sources look sufficient as supporting context. The human should still verify the actual diff.",
    tone: "added"
  }];
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

function sourceAuthority(source: SourceLink): string {
  const url = source.url.toLowerCase();
  const repo = (source.repository ?? "").toLowerCase();
  if (/docs\.|opentelemetry\.io|spring\.io|quarkus\.io|micronaut/.test(url)) return "official docs";
  if (repo.startsWith("micronaut-projects/")) return "same project";
  if (repo.startsWith("open-telemetry/") || repo.startsWith("oracle/")) return "upstream";
  if (source.codeSnippet) return "code example";
  return "";
}

function buildResearchFixInstructions(source: SourceLink): string {
  return `Use this research source while preparing a fix preview. First decide whether it is directly relevant to this PR; do not copy it blindly.

Research source:
${JSON.stringify(source, null, 2)}

Apply only concrete improvements that make the PR match the relevant lifecycle/API/test/docs pattern from the source. If the source is not applicable, leave a concise explanation in the fix session log instead of changing code.`;
}

function isSimplePr(detail: PrDetail, analysis?: AnalysisResult): boolean {
  const changedLines = detail.files
    .filter((file) => !isDocsPath(file.path) && !isTestPath(file.path))
    .reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const riskCount = analysis?.risks.length ?? 0;
  return changedLines <= 80 && (riskCount <= 2 || isDocsOnlyReview(undefined, detail, analysis));
}

function isDocsOnlyReview(_pr?: unknown, detail?: PrDetail, analysis?: AnalysisResult): boolean {
  if (analysis?.type === "docs") return true;
  if (!detail?.files.length) return false;
  return detail.files.every((file) => isDocsPath(file.path));
}

function isDocsPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.startsWith("docs/") || lower.startsWith("src/main/docs/") || lower.endsWith(".adoc") || lower.endsWith(".md") || lower.endsWith(".rst") || lower.endsWith(".txt");
}

function isTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes("/test/") || lower.includes("/tests/") || lower.includes("test-suite") || lower.endsWith(".spec.ts") || lower.endsWith(".test.ts");
}

function isDocRenderVerificationItem(item: string): boolean {
  const text = item.toLowerCase();
  return /\b(build|render|screenshot|html|site)\b/.test(text) && /\b(docs?|documentation|asciidoc|adoc|guide)\b/.test(text);
}

function anySharedDomainTerm(left: string, right: string): boolean {
  const terms = ["oracle", "ucp", "opentelemetry", "logging", "logid", "jdbc", "bom", "micronaut", "gradle", "maven", "bean", "lifecycle", "metrics", "tracing"];
  return terms.some((term) => left.includes(term) && right.includes(term));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
