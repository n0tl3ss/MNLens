import { FileSearch, Sparkles } from "lucide-react";
import type { AnalysisResult } from "../../../shared/types";
import { Badge } from "./uiBits";
import "./codexVerification.css";

export function TestAssessmentSection({
  assessment,
  onImproveTests
}: {
  assessment?: AnalysisResult["testAssessment"];
  onImproveTests?: (instructions: string) => void;
}) {
  if (!assessment) return null;
  const gaps = sortReviewTextItems(assessment.gaps);
  const recommendedTests = sortReviewTextItems(assessment.recommendedTests);
  return (
    <section className={`summary-card test-assessment ${assessment.rating}`}>
      <div className="insight-heading">
        <h3>Test Quality</h3>
        <div className="inline-actions">
          <Badge tone={toneForTestRating(assessment.rating)}>{assessment.rating}</Badge>
          {onImproveTests && (
            <>
              <button onClick={() => onImproveTests(buildTestPlanPatchInstructions(assessment))}>
                <FileSearch size={14} />
                Test plan patch
              </button>
              <button onClick={() => onImproveTests(buildTestImprovementInstructions(assessment))}>
                <Sparkles size={14} />
                Improve tests
              </button>
            </>
          )}
        </div>
      </div>
      <p>{assessment.summary || "No test assessment was generated."}</p>
      <div className="test-assessment-grid">
        <div>
          <strong>Covered</strong>
          {assessment.covered.length === 0 ? <p className="muted">No clear coverage identified.</p> : <ul>{assessment.covered.map((item) => <li key={item}>{item}</li>)}</ul>}
        </div>
        <div>
          <strong>Gaps</strong>
          {gaps.length === 0 ? <p className="muted">No obvious gaps listed.</p> : <ul>{gaps.map((item) => <li key={item}>{item}</li>)}</ul>}
        </div>
      </div>
      {recommendedTests.length > 0 && (
        <div className="recommended-tests">
          <strong>Recommended Tests</strong>
          <ul>{recommendedTests.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

function buildTestPlanPatchInstructions(assessment: NonNullable<AnalysisResult["testAssessment"]>): string {
  return `Prepare an automated test plan patch for this PR. This pass should focus on test/TCK coverage only.

Current test rating: ${assessment.rating}
Summary: ${assessment.summary || "No summary provided."}

Coverage gaps:
${assessment.gaps.length ? assessment.gaps.map((item) => `- ${item}`).join("\n") : "- No explicit gaps listed."}

Recommended tests:
${assessment.recommendedTests.length ? assessment.recommendedTests.map((item) => `- ${item}`).join("\n") : "- Add focused tests for the highest-risk behavior changed by this PR."}

Instructions:
- Do not change production/source behavior unless a tiny test seam is absolutely required and documented.
- Prefer an automated unit, integration, or TCK-style test over manual verification.
- Add tests that would fail against the old behavior or missing edge case where practical.
- If a gap truly requires external cloud resources, credentials, or paid infrastructure, add the closest automated guard and document what remains manual in the fix log.
- Run the smallest relevant test command and report the result.`;
}

function buildTestImprovementInstructions(assessment: NonNullable<AnalysisResult["testAssessment"]>): string {
  return `Improve the PR's test state based on the Test Quality assessment.

Current rating: ${assessment.rating}
Summary: ${assessment.summary || "No summary provided."}

Covered:
${assessment.covered.length ? assessment.covered.map((item) => `- ${item}`).join("\n") : "- No clear coverage identified."}

Gaps:
${assessment.gaps.length ? assessment.gaps.map((item) => `- ${item}`).join("\n") : "- No explicit gaps listed."}

Recommended tests:
${assessment.recommendedTests.length ? assessment.recommendedTests.map((item) => `- ${item}`).join("\n") : "- Add focused tests for the highest-risk behavior changed by this PR."}

Use the smallest useful patch. Prefer tests that would fail before the fix and pass after it. Run the relevant local test commands and report results in the fix session log.`;
}

function toneForTestRating(rating?: string): string {
  if (rating === "strong" || rating === "good") return "added";
  if (rating === "partial") return "queue";
  if (rating === "weak") return "danger";
  return "neutral";
}

function sortReviewTextItems(items: string[]): string[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => textPriority(b.item) - textPriority(a.item) || a.index - b.index)
    .map(({ item }) => item);
}

function textPriority(text: string): number {
  const value = text.toLowerCase();
  if (/\b(block|blocker|fail|failure|failed|missing|gap|risk|leak|duplicate|regression|security|unsafe|not covered|no test|do not approve)\b/.test(value)) return 4;
  if (/\b(verify|confirm|check|ensure|assert|coverage|edge case|should|must|needs|manual)\b/.test(value)) return 3;
  if (/\b(docs?|documentation|note|sample|example|style)\b/.test(value)) return 2;
  return 1;
}
