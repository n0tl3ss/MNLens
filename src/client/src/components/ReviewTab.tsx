import { Check, CheckCircle2, Circle, ClipboardCheck, Copy, FileSearch, Gavel, Loader2, MessageSquarePlus, RefreshCw, Scale, Sparkles, Target, Users, X } from "lucide-react";
import type { ReactNode } from "react";
import type { AcceptanceContract, AnalysisResult, CiCheck, FindingVerdict, PrDetail, ReviewComment, ReviewDraft, ReviewMemorySummary, ReviewProgress, SuggestedCommentKind, SuggestedReviewComment, VerificationJob } from "../../../shared/types";
import type { DraftReviewComment } from "./CommentTab";
import { acceptanceTotals } from "./AcceptanceSection";
import { Badge } from "./uiBits";
import "./reviewTab.css";

/**
 * The Review tab: the review the agent would post, laid out as the ordered
 * procedure a careful human follows.
 *
 *   MUST      understand → confirm it does what was asked → read the code with
 *             the suggested inline comments → verify the gating checks
 *   SHOULD    second opinion, non-gating checks
 *   OPTIONAL  nice-to-haves
 *   DECIDE    verdict + final comment, handed to the review dialog
 *
 * Every suggestion is a draft: "Add to review" copies a comment into the
 * reviewer's own draft; nothing reaches GitHub until they submit.
 */

export type ReviewTier = "must" | "should" | "optional" | "decide";

const tierLabel: Record<ReviewTier, string> = { must: "Mandatory", should: "Recommended", optional: "Optional", decide: "Decide" };

const kindMeta: Record<SuggestedCommentKind, { label: string; tone: string; tier: Exclude<ReviewTier, "decide"> }> = {
  blocking: { label: "blocking", tone: "danger", tier: "must" },
  important: { label: "important", tone: "review-needed", tier: "must" },
  question: { label: "question", tone: "queue", tier: "should" },
  suggestion: { label: "suggestion", tone: "improvement", tier: "should" },
  nit: { label: "nit", tone: "neutral", tier: "optional" },
  praise: { label: "praise", tone: "added", tier: "optional" }
};

export function ReviewTab({
  detail,
  analysis,
  acceptance,
  draft,
  draftBusy,
  draftError,
  progress,
  reviewComments,
  verificationJobs,
  ciChecks,
  secondOpinionBusy,
  memory,
  onCommentVerdict,
  onGenerateDraft,
  onGenerateAcceptance,
  onRequestSecondOpinion,
  onAddReviewComment,
  onUseFinalComment,
  onSaveProgress,
  onGoToTab
}: {
  detail: PrDetail;
  analysis?: AnalysisResult;
  acceptance?: AcceptanceContract | null;
  draft?: ReviewDraft | null;
  draftBusy: boolean;
  draftError?: string;
  progress?: ReviewProgress;
  reviewComments: DraftReviewComment[];
  verificationJobs: VerificationJob[];
  ciChecks: CiCheck[];
  secondOpinionBusy?: boolean;
  memory?: ReviewMemorySummary;
  /** Records whether the reviewer kept or dismissed a suggested comment (null = undo). Feeds the per-repo agent accuracy score. */
  onCommentVerdict?: (comment: SuggestedReviewComment, verdict: FindingVerdict | null) => void;
  onGenerateDraft: (force: boolean) => void;
  onGenerateAcceptance?: (force: boolean) => void;
  onRequestSecondOpinion?: () => void;
  onAddReviewComment: (comment: ReviewComment) => void;
  onUseFinalComment: (body: string) => void;
  onSaveProgress: (patch: Partial<Pick<ReviewProgress, "checkedItems" | "notes">>) => void;
  onGoToTab: (tab: "overview" | "diff" | "comment") => void;
}) {
  const analysisFresh = Boolean(analysis && analysis.diffHash === detail.diffHash);
  const acceptanceFresh = Boolean(acceptance && acceptance.diffHash === detail.diffHash);
  const draftStale = Boolean(draft && draft.diffHash !== detail.diffHash);
  const totals = acceptanceTotals(acceptance);
  const checked = new Set(progress?.checkedItems ?? []);
  const comments = draft?.comments ?? [];
  const byTier = (tier: Exclude<ReviewTier, "decide">) => comments.filter((comment) => kindMeta[comment.kind].tier === tier);
  const addedKeys = new Set(reviewComments.map((comment) => `${comment.path}|${comment.side}|${comment.line}`));
  const failingCi = ciChecks.filter((check) => check.bucket === "fail" || /fail|error|cancel/i.test(check.state ?? "")).length;
  const pendingCi = ciChecks.filter((check) => check.bucket === "pending" || /pending|queued|in_progress/i.test(check.state ?? "")).length;
  const lastVerification = verificationJobs.filter((job) => job.status === "done" || job.status === "failed").slice(-3);

  function toggleChecked(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSaveProgress({ checkedItems: [...next] });
  }

  const verdicts = memory?.prVerdicts ?? {};
  const verdictOf = (comment: SuggestedReviewComment): FindingVerdict | undefined => verdicts[verdictKey("draft-comment", comment.title)];
  const accuracy = memory?.draftComments;
  const accuracyTotal = accuracy ? accuracy.kept + accuracy.dismissed : 0;

  function addSuggested(comment: SuggestedReviewComment) {
    if (comment.line === undefined) return;
    onAddReviewComment({ path: comment.path, line: comment.line, side: comment.side, body: comment.body });
    onCommentVerdict?.(comment, "kept");
  }

  function addAll(list: SuggestedReviewComment[]) {
    for (const comment of list) if (comment.line !== undefined && !addedKeys.has(`${comment.path}|${comment.side}|${comment.line}`)) addSuggested(comment);
  }

  return (
    <div className="review-tab">
      <header className="review-tab-head summary-card">
        <div className="panel-title">
          <div>
            <h3>Recommended Review</h3>
            <p className="muted">The review the agent would post, in the order a careful reviewer works. Keep what you agree with; nothing is sent until you submit.</p>
          </div>
          <Gavel size={18} />
        </div>
        <div className="review-tab-meta">
          {draft ? (
            <>
              <DecisionBadge decision={draft.decision} />
              <span className="muted">
                {draft.agent === "claude" ? "Claude" : "Codex"} ({draft.model}){typeof draft.costUsd === "number" ? ` · ~$${draft.costUsd.toFixed(3)}` : ""} · {comments.length} suggested comments
              </span>
              {draftStale && <Badge tone="review-needed">diff changed</Badge>}
              <AccuracyBadge memory={memory} />
              <button type="button" className="ghost" onClick={() => onGenerateDraft(true)} disabled={draftBusy} title="Draft again from the current diff, analysis and acceptance contract">
                {draftBusy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {draftStale ? "Re-draft for new diff" : "Re-draft"}
              </button>
            </>
          ) : (
            <>
              <span className="muted">
                {analysisFresh ? "Analysis is fresh." : "Tip: run Deep Analyze first so the draft builds on it."} {acceptanceFresh ? "Acceptance contract is fresh." : "Building the acceptance contract first makes the verdict sharper."}
              </span>
              <button type="button" className="primary" onClick={() => onGenerateDraft(false)} disabled={draftBusy}>
                {draftBusy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {draftBusy ? "Drafting review..." : "Draft the review"}
              </button>
              <AccuracyBadge memory={memory} />
            </>
          )}
        </div>
        {draftError && <p className="review-error">{draftError}</p>}
        <ol className="review-legend" aria-label="Review tiers">
          <li>
            <TierBadge tier="must" /> gate the decision — do these before approving or requesting changes
          </li>
          <li>
            <TierBadge tier="should" /> raise confidence — skip only when you know the area well
          </li>
          <li>
            <TierBadge tier="optional" /> polish — follow-ups and nits
          </li>
        </ol>
      </header>

      <ol className="review-steps">
        <Step tier="must" index={1} icon={<FileSearch size={16} />} title="Understand the change" done={analysisFresh}>
          {analysisFresh && analysis ? (
            <>
              <p className="review-summary">{analysis.summary}</p>
              {(analysis.behaviorBefore || analysis.behaviorAfter) && (
                <dl className="review-behavior">
                  {analysis.behaviorBefore && (
                    <div>
                      <dt>Before</dt>
                      <dd>{analysis.behaviorBefore}</dd>
                    </div>
                  )}
                  {analysis.behaviorAfter && (
                    <div>
                      <dt>After</dt>
                      <dd>{analysis.behaviorAfter}</dd>
                    </div>
                  )}
                </dl>
              )}
            </>
          ) : (
            <p className="muted">
              {analysis ? "The analysis is for an older diff." : "No analysis yet."}{" "}
              <button type="button" className="link-button" onClick={() => onGoToTab("overview")}>
                Run Deep Analyze in Overview
              </button>
              , then come back.
            </p>
          )}
        </Step>

        <Step tier="must" index={2} icon={<ClipboardCheck size={16} />} title="Confirm it does what was asked" done={acceptanceFresh && totals.failed === 0 && totals.unproven === 0} warn={totals.failed > 0}>
          {acceptanceFresh && acceptance ? (
            <div className="review-inline">
              <strong>
                {totals.proven}/{totals.total - totals.notApplicable} criteria proven
              </strong>
              {totals.failed > 0 && <Badge tone="danger">{totals.failed} failed</Badge>}
              {totals.unproven > 0 && <Badge tone="review-needed">{totals.unproven} unproven — verify or ask</Badge>}
              <button type="button" className="link-button" onClick={() => onGoToTab("overview")}>
                Open contract
              </button>
            </div>
          ) : (
            <p className="muted">
              No acceptance contract for this diff.{" "}
              {onGenerateAcceptance && (
                <button type="button" className="link-button" onClick={() => onGenerateAcceptance(true)}>
                  Build it now
                </button>
              )}
            </p>
          )}
        </Step>

        <Step tier="must" index={3} icon={<MessageSquarePlus size={16} />} title="Read the code — blocking and important comments" done={Boolean(draft) && byTier("must").every((comment) => comment.line === undefined || addedKeys.has(`${comment.path}|${comment.side}|${comment.line}`))} count={draft ? byTier("must").length : undefined}>
          {!draft ? (
            <p className="muted">Draft the review to see where the agent would comment.</p>
          ) : byTier("must").length === 0 ? (
            <p className="review-ok">
              <CheckCircle2 size={14} /> No blocking or important issues found.
            </p>
          ) : (
            <>
              <CommentList comments={byTier("must")} addedKeys={addedKeys} verdictOf={verdictOf} onAdd={addSuggested} onVerdict={onCommentVerdict} />
              <div className="review-actions">
                <button type="button" onClick={() => addAll(byTier("must"))}>
                  Add all to my review
                </button>
                <button type="button" className="ghost" onClick={() => onGoToTab("diff")}>
                  Open diff
                </button>
              </div>
            </>
          )}
        </Step>

        <Step tier="must" index={4} icon={<Check size={16} />} title="Verify before deciding" done={Boolean(draft) && (draft?.mustDo.length ?? 0) > 0 && draft!.mustDo.every((_, i) => checked.has(checkId(draft!, "must", i)))} warn={failingCi > 0}>
          <div className="review-inline">
            {failingCi > 0 ? <Badge tone="danger">{failingCi} CI check(s) failing</Badge> : pendingCi > 0 ? <Badge tone="queue">{pendingCi} CI check(s) pending</Badge> : ciChecks.length > 0 ? <Badge tone="added">CI green</Badge> : <Badge tone="neutral">no CI data</Badge>}
            {lastVerification.map((job) => {
              const passed = job.status === "done" && (job.exitCode ?? 0) === 0;
              return (
                <Badge key={job.id} tone={passed ? "added" : "danger"}>
                  {job.command.split(" ").slice(0, 3).join(" ")} {passed ? "passed" : "failed"}
                </Badge>
              );
            })}
          </div>
          <Checklist draft={draft} tier="must" items={draft?.mustDo ?? []} checked={checked} onToggle={toggleChecked} empty="Draft the review to get the gating checks for this PR." />
        </Step>

        <Step tier="should" index={5} icon={<Users size={16} />} title="Get a second opinion" done={Boolean(analysis?.secondOpinion && analysis.secondOpinion.diffHash === detail.diffHash)}>
          {analysis?.secondOpinion && analysis.secondOpinion.diffHash === detail.diffHash ? (
            <div className="review-inline">
              <Badge tone={analysis.secondOpinion.verdict === "disagree" ? "danger" : analysis.secondOpinion.verdict === "agree" ? "added" : "review-needed"}>{analysis.secondOpinion.verdict}</Badge>
              <span>{analysis.secondOpinion.summary}</span>
              {analysis.secondOpinion.disputed.length > 0 && <span className="muted">{analysis.secondOpinion.disputed.length} disputed</span>}
              {analysis.secondOpinion.missed.length > 0 && <span className="muted">{analysis.secondOpinion.missed.length} missed</span>}
            </div>
          ) : (
            <p className="muted">
              The other vendor's economy model audits the analysis; disagreements are where your attention pays off.{" "}
              {onRequestSecondOpinion && analysisFresh && (
                <button type="button" className="link-button" onClick={onRequestSecondOpinion} disabled={secondOpinionBusy}>
                  {secondOpinionBusy ? "Asking..." : "Ask now"}
                </button>
              )}
            </p>
          )}
        </Step>

        <Step tier="should" index={6} icon={<Scale size={16} />} title="Questions and suggestions" count={draft ? byTier("should").length : undefined}>
          {draft && byTier("should").length > 0 && <CommentList comments={byTier("should")} addedKeys={addedKeys} verdictOf={verdictOf} onAdd={addSuggested} onVerdict={onCommentVerdict} />}
          <Checklist draft={draft} tier="should" items={draft?.shouldDo ?? []} checked={checked} onToggle={toggleChecked} empty={draft ? "Nothing extra recommended." : "Draft the review to see recommended checks."} />
        </Step>

        <Step tier="optional" index={7} icon={<Sparkles size={16} />} title="Nits, praise and follow-ups" count={draft ? byTier("optional").length : undefined}>
          {draft && byTier("optional").length > 0 && <CommentList comments={byTier("optional")} addedKeys={addedKeys} verdictOf={verdictOf} onAdd={addSuggested} onVerdict={onCommentVerdict} />}
          <Checklist draft={draft} tier="optional" items={draft?.optional ?? []} checked={checked} onToggle={toggleChecked} empty={draft ? "No optional items." : "Draft the review to see optional items."} />
        </Step>

        <Step tier="decide" index={8} icon={<Gavel size={16} />} title="Decide and write the final comment">
          {!draft ? (
            <p className="muted">The verdict and final comment appear here once the review is drafted.</p>
          ) : (
            <>
              <div className="review-inline">
                <DecisionBadge decision={draft.decision} />
                <span>{draft.decisionRationale}</span>
              </div>
              <pre className="review-final-comment">{draft.finalComment || "(no final comment)"}</pre>
              <div className="review-actions">
                <button type="button" className="primary" onClick={() => onUseFinalComment(draft.finalComment)} disabled={!draft.finalComment}>
                  Use as review comment
                </button>
                <button type="button" onClick={() => void navigator.clipboard.writeText(draft.finalComment)} disabled={!draft.finalComment}>
                  <Copy size={14} /> Copy
                </button>
                <button type="button" className="ghost" onClick={() => onGoToTab("comment")}>
                  Review my {reviewComments.filter((comment) => comment.body.trim()).length} draft comment(s)
                </button>
              </div>
              <p className="muted review-footnote">"Use as review comment" fills the review dialog; you still pick Approve / Request changes / Comment yourself.</p>
            </>
          )}
          <label className="review-notes-field">
            <span className="muted">Private notes (never posted)</span>
            <textarea value={progress?.notes ?? ""} placeholder="Things to remember for this review..." onChange={(event) => onSaveProgress({ notes: event.target.value })} />
          </label>
        </Step>
      </ol>
    </div>
  );
}

export function checkId(draft: ReviewDraft, tier: "must" | "should" | "optional", index: number): string {
  return `review-draft:${draft.diffHash.slice(0, 12)}:${tier}:${index}`;
}

function Step({ tier, index, icon, title, done, warn, count, children }: { tier: ReviewTier; index: number; icon: ReactNode; title: string; done?: boolean; warn?: boolean; count?: number; children: ReactNode }) {
  return (
    <li className={`review-step tier-${tier} ${done ? "done" : ""} ${warn ? "warn" : ""}`}>
      <div className="review-step-head">
        <span className="review-step-index" aria-hidden>
          {done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
        </span>
        <span className="review-step-icon">{icon}</span>
        <h4>
          <span className="muted">{index}.</span> {title}
          {typeof count === "number" && count > 0 && <Badge tone="neutral">{count}</Badge>}
        </h4>
        <TierBadge tier={tier} />
      </div>
      <div className="review-step-body">{children}</div>
    </li>
  );
}

export function TierBadge({ tier }: { tier: ReviewTier }) {
  return <span className={`review-tier review-tier-${tier}`}>{tierLabel[tier]}</span>;
}

function DecisionBadge({ decision }: { decision: ReviewDraft["decision"] }) {
  const tone = decision === "APPROVE" ? "added" : decision === "REQUEST_CHANGES" ? "danger" : "queue";
  const label = decision === "APPROVE" ? "Approve" : decision === "REQUEST_CHANGES" ? "Request changes" : "Comment only";
  return <Badge tone={tone}>{label}</Badge>;
}

function CommentList({
  comments,
  addedKeys,
  verdictOf,
  onAdd,
  onVerdict
}: {
  comments: SuggestedReviewComment[];
  addedKeys: Set<string>;
  verdictOf: (comment: SuggestedReviewComment) => FindingVerdict | undefined;
  onAdd: (comment: SuggestedReviewComment) => void;
  onVerdict?: (comment: SuggestedReviewComment, verdict: FindingVerdict | null) => void;
}) {
  return (
    <ul className="review-comments">
      {comments.map((comment) => {
        const added = comment.line !== undefined && addedKeys.has(`${comment.path}|${comment.side}|${comment.line}`);
        const verdict = verdictOf(comment);
        const dismissed = verdict === "dismissed";
        if (dismissed) {
          return (
            <li key={comment.id} className={`review-comment kind-${comment.kind} dismissed`}>
              <div className="review-comment-head">
                <Badge tone={kindMeta[comment.kind].tone}>{kindMeta[comment.kind].label}</Badge>
                <s>{comment.title}</s>
                <span className="muted">dismissed — counted against the agent's accuracy</span>
                {onVerdict && (
                  <button type="button" className="link-button" onClick={() => onVerdict(comment, null)}>
                    Undo
                  </button>
                )}
              </div>
            </li>
          );
        }
        return (
          <li key={comment.id} className={`review-comment kind-${comment.kind} ${added ? "added" : ""}`}>
            <div className="review-comment-head">
              <Badge tone={kindMeta[comment.kind].tone}>{kindMeta[comment.kind].label}</Badge>
              <strong>{comment.title}</strong>
              <code className="review-comment-anchor">
                {comment.path}
                {comment.line !== undefined ? `:${comment.line}${comment.side === "LEFT" ? " (old)" : ""}` : ""}
              </code>
              {comment.unanchored && (
                <span title="The agent's line was not in the diff; place this comment by hand.">
                  <Badge tone="review-needed">place manually</Badge>
                </span>
              )}
              {comment.criterion && <span className="muted review-comment-criterion">↳ {comment.criterion}</span>}
            </div>
            <pre className="review-comment-body">{comment.body}</pre>
            {comment.rationale && <p className="review-comment-rationale muted">Why: {comment.rationale}</p>}
            <div className="review-actions">
              {comment.line !== undefined ? (
                <button type="button" onClick={() => onAdd(comment)} disabled={added} title={added ? "Already in your draft" : "Add this comment to your review draft at this line"}>
                  {added ? <CheckCircle2 size={14} /> : <MessageSquarePlus size={14} />} {added ? "In my review" : "Add to my review"}
                </button>
              ) : (
                <span className="muted">Open the diff, pick the line, paste the text.</span>
              )}
              <button type="button" className="ghost" onClick={() => void navigator.clipboard.writeText(comment.body)}>
                <Copy size={14} /> Copy
              </button>
              {onVerdict && !added && (
                <button type="button" className="ghost" onClick={() => onVerdict(comment, "dismissed")} title="Not worth posting. Recorded so the agent raises fewer comments like this in this repository.">
                  <X size={14} /> Dismiss
                </button>
              )}
              {verdict === "kept" && !added && <span className="muted">kept</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Mirrors server/reviewMemory.ts verdictKey so the client can look up this PR's verdicts. */
export function verdictKey(kind: string, title: string): string {
  return `${kind}:${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

/**
 * Agent accuracy = share of suggested comments reviewers kept in this repo.
 * Shown once there are a few verdicts; the per-kind breakdown is in the tooltip.
 */
function AccuracyBadge({ memory }: { memory?: ReviewMemorySummary }) {
  const stat = memory?.draftComments;
  if (!stat) return null;
  const total = stat.kept + stat.dismissed;
  if (total < 3) {
    return (
      <span className="muted review-accuracy" title="Add or dismiss suggested comments; after 3 verdicts MNLens shows how often this agent's comments were worth posting in this repository.">
        <Target size={13} /> accuracy: {total}/3 verdicts so far
      </span>
    );
  }
  const rate = Math.round((stat.kept / total) * 100);
  const tone = rate >= 70 ? "added" : rate >= 40 ? "review-needed" : "danger";
  const breakdown = Object.entries(stat.byKind)
    .map(([kind, item]) => `${kind}: ${item.kept}/${item.kept + item.dismissed} kept`)
    .join("\n");
  return (
    <span className="review-accuracy" title={`${stat.kept} of ${total} suggested comments kept in ${memory?.repository}${memory?.members && memory.members > 1 ? ` across ${memory.members} reviewers` : ""}.\n${breakdown}`}>
      <Target size={13} />
      <Badge tone={tone}>{rate}% kept</Badge>
      <span className="muted">
        {stat.kept}/{total} suggestions{memory?.shared ? " · team" : ""}
      </span>
    </span>
  );
}

function Checklist({ draft, tier, items, checked, onToggle, empty }: { draft?: ReviewDraft | null; tier: "must" | "should" | "optional"; items: string[]; checked: Set<string>; onToggle: (id: string) => void; empty: string }) {
  if (!draft || items.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="rt-checklist">
      {items.map((item, index) => {
        const id = checkId(draft, tier, index);
        return (
          <li key={id} className={checked.has(id) ? "checked" : ""}>
            <label>
              <input type="checkbox" checked={checked.has(id)} onChange={() => onToggle(id)} />
              <span>{item}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
