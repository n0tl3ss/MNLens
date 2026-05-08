import { Loader2, MessageSquare, Sparkles } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AnalysisResult, PrDetail, ReviewInsight, ReviewProgress } from "../../../shared/types";
import { askRisk } from "../api";
import { insightScope, insightScopeLabel } from "../reviewHelpers";
import { Badge } from "./uiBits";

export function InsightSection({
  title,
  tone,
  items,
  details = [],
  compact,
  detail,
  onStartFix,
  progress,
  onSaveProgress
}: {
  title: string;
  tone: "evidence" | "focus" | "risk";
  items: string[];
  details?: AnalysisResult["reviewerFocusDetails"];
  compact: boolean;
  detail?: PrDetail;
  onStartFix?: (instructions?: string, baseJobId?: string, source?: string) => void;
  progress?: ReviewProgress;
  onSaveProgress?: (patch: Partial<Pick<ReviewProgress, "checkedItems">>) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const detailItems = details.length > 0 ? sortReviewInsights(details) : [];
  const sortedItems = sortReviewTextItems(items);
  const sourceItems: Array<Partial<ReviewInsight> & { observation: string }> =
    detailItems.length > 0 ? detailItems : sortedItems.map((item) => ({ observation: item }));
  const displayItems = compact && !showAll ? sourceItems.slice(0, 2) : sourceItems;
  const hiddenCount = sourceItems.length - displayItems.length;
  const checkedItems = new Set(progress?.checkedItems ?? []);

  function toggleInsight(id: string) {
    if (!onSaveProgress) return;
    onSaveProgress({
      checkedItems: checkedItems.has(id)
        ? (progress?.checkedItems ?? []).filter((item) => item !== id)
        : [...(progress?.checkedItems ?? []), id]
    });
  }

  return (
    <section className={`summary-card insight-section ${tone}`}>
      <div className="insight-heading">
        <h3>{title}</h3>
        {hiddenCount > 0 && (
          <button className="text-button more-toggle" onClick={() => setShowAll(true)}>
            +{hiddenCount} more
          </button>
        )}
        {showAll && compact && sourceItems.length > 2 && (
          <button className="text-button more-toggle" onClick={() => setShowAll(false)}>
            Show less
          </button>
        )}
      </div>
      {displayItems.length === 0 ? (
        <p className="muted">No items yet.</p>
      ) : (
        <div className="insight-list">
          {displayItems.map((item, index) => {
            const id = insightProgressId(title, item, index);
            const checked = checkedItems.has(id);
            const heading = item.title ?? item.observation;
            return (
              <article key={id} className={checked ? "checked" : ""}>
                <span className="insight-rank">{index + 1}</span>
                <div>
                  <div className="insight-title">
                    {onSaveProgress ? (
                      <button className="text-button" onClick={() => toggleInsight(id)} title={checked ? "Reopen this review point" : "Mark this review point complete"}>
                        <strong>{heading}</strong>
                      </button>
                    ) : (
                      <strong>{heading}</strong>
                    )}
                    <div className="inline-actions">
                      <Badge tone={toneForSeverity(item.severity)}>{item.severity ?? "info"}</Badge>
                      <Badge tone={insightScope(item) === "test-maintainability" ? "queue" : "feature"}>{insightScopeLabel(item)}</Badge>
                      {onSaveProgress && (
                        <label className="insight-done-check" title={checked ? "Reopen this review point" : "Mark this review point complete"}>
                          <input type="checkbox" checked={checked} onChange={() => toggleInsight(id)} />
                          {checked ? "Done" : "Mark done"}
                        </label>
                      )}
                    </div>
                  </div>
                  {!checked && (
                    <>
                      {item.title && <p>{item.observation}</p>}
                      {item.perspective && (
                        <p className="reviewer-perspective">
                          <b>My take:</b> {item.perspective}
                        </p>
                      )}
                      {item.recommendation && (
                        <p className="reviewer-recommendation">
                          <b>Action:</b> {item.recommendation}
                        </p>
                      )}
                      {(tone === "risk" || tone === "focus") && detail && (
                        <InsightQuestionBox
                          detail={detail}
                          insight={item}
                          tone={tone}
                          sourceLabel={`Overview / ${title} / ${tone === "risk" ? "Risk" : "Focus"} ${index + 1}`}
                          onStartFix={onStartFix}
                        />
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function InsightQuestionBox({
  detail,
  insight,
  tone,
  sourceLabel,
  onStartFix
}: {
  detail: PrDetail;
  insight: Partial<ReviewInsight> & { observation: string };
  tone: "focus" | "risk";
  sourceLabel: string;
  onStartFix?: (instructions?: string, baseJobId?: string, source?: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const label = tone === "risk" ? "risk" : "review focus";

  async function ask(nextQuestion = question) {
    const trimmed = nextQuestion.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    try {
      const response = await askRisk({
        owner: detail.owner,
        repo: detail.repo,
        number: detail.number,
        risk: { observation: insightQuestionContext(insight, label) },
        question: trimmed
      });
      setAnswer(response.answer);
      if (nextQuestion === question) setQuestion("");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="risk-question">
      <textarea
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder={`Ask Codex for more context about this ${label}...`}
      />
      <div>
        <button disabled={loading} onClick={() => void ask(`Explain this ${label} in more detail. Is it likely still valid, what evidence supports it, what would resolve it, and what should I inspect next?`)}>
          {loading ? <Loader2 size={14} className="spin" /> : <MessageSquare size={14} />}
          Explain more
        </button>
        {onStartFix && (
          <button onClick={() => onStartFix(buildInsightFixInstructions(insight, label), undefined, sourceLabel)}>
            <Sparkles size={14} />
            Address with Codex
          </button>
        )}
        <button disabled={loading || question.trim().length === 0} onClick={() => void ask()}>
          {loading ? <Loader2 size={14} className="spin" /> : <MessageSquare size={14} />}
          Ask Codex
        </button>
      </div>
      {error && <p className="risk-answer error-text">{error}</p>}
      {answer && (
        <div className="risk-answer markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function insightQuestionContext(insight: Partial<ReviewInsight> & { observation: string }, label: string): string {
  return [
    `Kind: ${label}`,
    insight.title ? `Title: ${insight.title}` : "",
    `Observation: ${insight.observation}`,
    insight.perspective ? `Perspective: ${insight.perspective}` : "",
    insight.recommendation ? `Recommendation: ${insight.recommendation}` : "",
    insight.severity ? `Severity: ${insight.severity}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildInsightFixInstructions(insight: Partial<ReviewInsight> & { observation: string }, label: string): string {
  return `Address this specific ${label} in the smallest coherent patch, and add or update tests if the point is behavioral.

Review point:
${insightQuestionContext(insight, label)}

Before editing, inspect existing project patterns and confirm whether this point is real and actionable. If it is already resolved, do not make speculative code changes; instead leave a concise summary in the fix session log.`;
}

function insightProgressId(section: string, item: Partial<ReviewInsight> & { observation: string }, index: number): string {
  const source = `${section}:${item.title ?? ""}:${item.observation}:${index}`;
  let hash = 0;
  for (const char of source) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `insight:${section.toLowerCase().replace(/\s+/g, "-")}:${hash.toString(16)}`;
}

function sortReviewInsights<T extends Partial<ReviewInsight>>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => severityRank(b.item.severity) - severityRank(a.item.severity) || a.index - b.index)
    .map(({ item }) => item);
}

function sortReviewTextItems(items: string[]): string[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => textPriority(b.item) - textPriority(a.item) || a.index - b.index)
    .map(({ item }) => item);
}

function severityRank(severity?: string): number {
  if (severity === "high") return 4;
  if (severity === "medium") return 3;
  if (severity === "low") return 2;
  if (severity === "info") return 1;
  return 0;
}

function textPriority(item: string): number {
  const text = item.toLowerCase();
  if (/\b(block|blocker|fail|failure|failed|missing|gap|risk|leak|duplicate|regression|security|unsafe|not covered|no test|do not approve)\b/.test(text)) return 4;
  if (/\b(verify|confirm|check|ensure|assert|coverage|edge case|should|must|needs|manual)\b/.test(text)) return 3;
  if (/\b(docs?|documentation|note|sample|example|style)\b/.test(text)) return 2;
  return 1;
}

function toneForSeverity(severity?: string): string {
  if (severity === "high") return "danger";
  if (severity === "medium") return "queue";
  if (severity === "low") return "improvement";
  return "neutral";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
