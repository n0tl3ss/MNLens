import { Clipboard } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LinkedIssue, PrDetail, ReviewProgress } from "../../../shared/types";
import type { ReviewScore } from "../reviewScoring";
import { AuthorLink, Badge, plural } from "./uiBits";

export type ReviewRecommendation = {
  decision: "approve" | "request-changes" | "hold";
  label: string;
  tone: string;
  confidence: "low" | "medium" | "high";
  summary: string;
  blockers: string[];
  evidence: Array<{ title: string; body: string; tone: string }>;
  score: ReviewScore;
  draftBody: string;
};

export function FinalRecommendationSection({ recommendation }: { recommendation: ReviewRecommendation }) {
  return (
    <section className={`summary-card final-recommendation-card ${recommendation.tone}`}>
      <div className="recommendation-hero">
        <div>
          <span className="eyebrow">Final review recommendation</span>
          <h3>{recommendation.label}</h3>
          <p>{recommendation.summary}</p>
        </div>
        <div className="recommendation-meta">
          <Badge tone={recommendation.tone}>{recommendation.decision.replace("-", " ")}</Badge>
          <span>{recommendation.confidence} confidence</span>
        </div>
      </div>
      <div className="recommendation-grid">
        <div>
          <h4>Why</h4>
          <div className="recommendation-evidence">
            {recommendation.evidence.map((item) => (
              <article key={`${item.title}:${item.body}`} className={item.tone}>
                <Badge tone={item.tone}>{item.title}</Badge>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
        <div>
          <h4>{recommendation.blockers.length > 0 ? "Before you submit" : "Review body"}</h4>
          {recommendation.blockers.length > 0 && (
            <ul className="recommendation-blockers">
              {recommendation.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          <details className="recommendation-draft">
            <summary>Draft review text</summary>
            <p>{recommendation.draftBody}</p>
            <button onClick={() => void navigator.clipboard.writeText(recommendation.draftBody)}>
              <Clipboard size={16} />
              Copy
            </button>
          </details>
        </div>
      </div>
      <ScoreExplanation score={recommendation.score} />
    </section>
  );
}

export function PrContextSection({ detail, progress }: { detail: PrDetail; progress?: ReviewProgress }) {
  const linkedIssues = detail.linkedIssues ?? [];
  const hasBody = detail.body.trim().length > 0;
  return (
    <section className="summary-card pr-context-card">
      <div className="panel-title">
        <div>
          <h3>PR Context</h3>
          <p className="muted">Intent used by analysis: the PR description plus linked issue problem statement, labels, and discussion signals when GitHub exposes them.</p>
        </div>
        <Badge tone={linkedIssues.length > 0 ? "feature" : "neutral"}>{linkedIssues.length > 0 ? plural(linkedIssues.length, "linked issue") : "no linked issue"}</Badge>
      </div>
      <div className="pr-context-grid">
        <div className="pr-body-card">
          <div className="context-subtitle">
            <strong>Main PR comment</strong>
            <a href={detail.url} target="_blank" rel="noreferrer">Open PR</a>
          </div>
          {hasBody ? <MarkdownBody body={detail.body} /> : <p className="muted">No PR description was provided.</p>}
        </div>
        <div className="linked-issue-list">
          <div className="context-subtitle">
            <strong>Linked issues</strong>
            <span>{linkedIssues.length}</span>
          </div>
          {linkedIssues.length === 0 ? (
            <p className="muted">No closing or linked issue was reported by GitHub for this PR.</p>
          ) : (
            linkedIssues.map((issue) => (
              <article key={`${issue.repository}-${issue.number}-${issue.url}`}>
                <div>
                  <Badge tone={issue.state === "CLOSED" ? "added" : "queue"}>{issue.state ?? "issue"}</Badge>
                  {issueProject(detail, issue, progress) && <Badge tone="feature">{issueProject(detail, issue, progress)}</Badge>}
                  <span>
                    {issue.repository ?? detail.repository} #{issue.number || "?"}
                  </span>
                  {issue.author && (
                    <span>
                      by <AuthorLink name={issue.author} url={issue.authorUrl} />
                    </span>
                  )}
                  {typeof issue.commentsCount === "number" && <span>{plural(issue.commentsCount, "comment")}</span>}
                </div>
                <strong>{issue.title}</strong>
                {issue.body && (
                  <div className="linked-issue-body">
                    <MarkdownBody body={issue.body} />
                  </div>
                )}
                {issue.labels && issue.labels.length > 0 && (
                  <span className="linked-issue-labels">
                    {issue.labels.slice(0, 5).map((label) => (
                      <Badge key={label} tone="label">
                        {label}
                      </Badge>
                    ))}
                  </span>
                )}
                {issue.url && (
                  <a href={issue.url} target="_blank" rel="noreferrer">
                    Open linked issue
                  </a>
                )}
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export function linkedIssueProjectKey(issue: LinkedIssue, fallbackRepository: string): string {
  return `${issue.repository ?? fallbackRepository}#${issue.number}`;
}

function issueProject(detail: PrDetail, issue: LinkedIssue, progress?: ReviewProgress): string {
  return progress?.issueProjects?.[linkedIssueProjectKey(issue, detail.repository)] ?? "";
}

function ScoreExplanation({ score }: { score: ReviewScore }) {
  const negative = score.breakdown.adjustments.filter((item) => item.points < 0).sort((a, b) => a.points - b.points);
  const positive = score.breakdown.adjustments.filter((item) => item.points > 0).sort((a, b) => b.points - a.points);
  const rawScore = score.breakdown.base + score.breakdown.adjustments.reduce((sum, item) => sum + item.points, 0);
  const negativeTotal = negative.reduce((sum, item) => sum + item.points, 0);
  const positiveTotal = positive.reduce((sum, item) => sum + item.points, 0);
  return (
    <div className="score-explanation">
      <div>
        <h4>Why {score.score}/100</h4>
        <p>
          Starts at <b>{score.breakdown.base}</b>, applies <b>{negativeTotal}</b> in deductions and <b>+{positiveTotal}</b> in bonuses, ending at <b>{rawScore}</b>
          {rawScore !== score.score ? `, clamped to ${score.score}` : ""}. The score is about merge readiness and remaining reviewer work, not just GitHub approval state.
        </p>
      </div>
      <div className="score-adjustment-columns">
        <div>
          <h5>Lowering score</h5>
          {negative.length === 0 ? (
            <p className="muted">No major deductions right now.</p>
          ) : (
            <div className="score-adjustments">
              {negative.map((item) => (
                <article key={`${item.label}:${item.points}`} className={item.tone}>
                  <strong>{item.points}</strong>
                  <div>
                    <b>{item.label}</b>
                    <p>{item.reason}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        <div>
          <h5>Raising score</h5>
          {score.breakdown.raiseActions.length === 0 ? (
            <p className="muted">The remaining gain is mostly a final human diff pass.</p>
          ) : (
            <ul className="score-actions">
              {score.breakdown.raiseActions.slice(0, 5).map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          )}
          {positive.length > 0 && (
            <div className="score-bonuses">
              {positive.map((item) => (
                <Badge key={`${item.label}:${item.points}`} tone={item.tone}>
                  +{item.points} {item.label}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}
