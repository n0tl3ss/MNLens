import type { ReviewReadiness, ReviewScore } from "../reviewScoring";

export function PrScoreCard({ score }: { score: ReviewScore }) {
  return (
    <aside className={`pr-score-card ${score.tone}`}>
      <div>
        <strong>{score.score}</strong>
        <span>/100</span>
      </div>
      <p>{score.label}</p>
      <em>{score.effort.label} review</em>
      <small>{score.effort.minutes}</small>
    </aside>
  );
}

export function ReadinessSection({ readiness }: { readiness: ReviewReadiness }) {
  return (
    <section className={`summary-card readiness-card ${readiness.tone}`}>
      <div className="insight-heading">
        <h3>Review Readiness</h3>
        <span className={`badge ${readiness.tone}`}>{readiness.label}</span>
      </div>
      <p>{readiness.summary}</p>
      {readiness.blockers.length > 0 && (
        <ul>
          {readiness.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
