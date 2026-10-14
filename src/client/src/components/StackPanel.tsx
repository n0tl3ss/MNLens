import { ExternalLink, GitBranch, GitMerge, Layers, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { PrStack, PrStackNode, StackMergeMethod, StackMergePlan } from "../../../shared/types";
import { Badge } from "./uiBits";
import "./stackPanel.css";

/**
 * The Stack tab: the chain a PR belongs to (root → leaf), the reviewer's
 * position in it, parent/children state, the bottom-up merge plan and the
 * "restack" action. Restacking reuses the branch-update preview: for a
 * stacked PR the base branch *is* the parent branch, so "Update branch" already
 * rebases/merges the PR onto its parent and keeps the result behind human approval.
 */
export function StackPanel({
  stack,
  plan,
  loading,
  busy,
  merging,
  mergeError,
  preview,
  onSelect,
  onRefresh,
  onRestack,
  onMerge
}: {
  stack?: PrStack;
  plan?: StackMergePlan;
  loading: boolean;
  busy: boolean;
  merging?: boolean;
  mergeError?: string;
  /** The branch-update (restack) preview, rendered inside the tab while it is open. */
  preview?: ReactNode;
  onSelect: (node: PrStackNode) => void;
  onRefresh: () => void;
  onRestack: () => void;
  onMerge?: (number: number, method: StackMergeMethod) => void;
}) {
  const [method, setMethod] = useState<StackMergeMethod>("squash");
  if (!stack && loading) return <p className="empty wide">Checking the stack on GitHub...</p>;
  if (!stack || !stack.isStacked) {
    return (
      <section className="summary-card stack-empty" aria-label="Pull request stack">
        <h3>Not part of a stack</h3>
        <p className="muted">MNLens detects a stack when a PR's base branch is another open PR's head branch in the same repository.</p>
        <button type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Check again
        </button>
      </section>
    );
  }

  const nextStep = plan?.steps.find((step) => step.isNext);
  const currentStep = plan?.steps.find((step) => step.isCurrent);
  const parent = stack.parent;
  const parentMerged = Boolean(parent && parent.state !== "OPEN");
  const parentApproved = parent?.reviewDecision === "APPROVED";
  const lastIndex = stack.chain.length - 1;

  return (
    <section className="stack-tab" aria-label="Pull request stack">
      <header className="summary-card stack-head">
        <div className="insight-heading">
          <h3>
            <Layers size={16} /> Stacked pull request
          </h3>
          <div className="inline-actions">
            <Badge tone="stack">
              {stack.position} of {stack.chain.length}
            </Badge>
            <button type="button" className="icon-button" onClick={onRefresh} disabled={loading || busy} title="Refresh the stack from GitHub">
              <RefreshCw size={14} className={loading ? "spin" : ""} />
            </button>
            {parent && (
              <button type="button" onClick={onRestack} disabled={busy} title={`Preview rebasing this PR onto ${parent.headRefName}. Nothing is pushed until you approve.`}>
                <GitBranch size={14} />
                Restack onto #{parent.number}
              </button>
            )}
          </div>
        </div>
        <p className="stack-note">
          {parent
            ? parentMerged
              ? `Parent #${parent.number} is no longer open. GitHub retargets this PR to ${stack.trunk} once the parent branch is deleted; re-run Deep Analyze because the diff scope changed.`
              : `This diff is relative to #${parent.number} (${parent.headRefName}), which is ${parentApproved ? "approved" : "not approved yet"}. Review only the incremental change and merge parents first, bottom-up.`
            : `This is the root of the stack. ${stack.children.length === 1 ? `#${stack.children[0].number} builds on it.` : `${stack.children.length} PRs build on it.`} Merging or force-pushing here affects the whole stack.`}
        </p>
        <dl className="stack-facts">
          <div>
            <dt>Trunk</dt>
            <dd>
              <code>{stack.trunk}</code>
            </dd>
          </div>
          <div>
            <dt>Parent</dt>
            <dd>
              {parent ? (
                <>
                  #{parent.number} <code>{parent.headRefName}</code>
                  {parentMerged ? <Badge tone="queue">no longer open</Badge> : parentApproved ? <Badge tone="added">approved</Badge> : <Badge tone="review-needed">not approved</Badge>}
                </>
              ) : (
                "none, this is the root"
              )}
            </dd>
          </div>
          <div>
            <dt>Children</dt>
            <dd>{stack.children.length > 0 ? stack.children.map((child) => `#${child.number}`).join(", ") : "none, this is the leaf"}</dd>
          </div>
          <div>
            <dt>Checked</dt>
            <dd>{relativeMinutes(stack.fetchedAt)}</dd>
          </div>
        </dl>
      </header>

      <div className="stack-columns">
        <section className="summary-card stack-chain-card">
          <div>
            <h3>Chain, root to leaf</h3>
            <p className="muted">Each PR's diff is relative to the branch above it. Select a PR to review it; the current one is highlighted.</p>
          </div>
          <ol className="stack-chain">
            {stack.chain.map((node, index) => {
              const current = node.number === stack.number;
              return (
                <li key={node.number} className={`stack-node ${current ? "current" : ""} ${index === 0 ? "root" : ""} ${index === lastIndex ? "leaf" : ""}`}>
                  <span className="stack-rail" aria-hidden="true">
                    <i />
                  </span>
                  <div className="stack-node-card">
                    <div className="stack-node-head">
                      <button type="button" className="stack-node-select" onClick={() => !current && onSelect(node)} disabled={current} title={current ? "This PR" : `Review #${node.number} in MNLens`}>
                        <span className="stack-node-number">#{node.number}</span>
                        <span className="stack-node-title">{node.title}</span>
                      </button>
                      <a className="stack-node-link" href={node.url} target="_blank" rel="noreferrer" title={`Open #${node.number} on GitHub`}>
                        <ExternalLink size={13} />
                      </a>
                    </div>
                    <div className="stack-node-meta">
                      <code>{node.headRefName}</code>
                      <span>onto</span>
                      <code>{node.baseRefName}</code>
                      {current && <Badge tone="stack">this PR</Badge>}
                      {node.isDraft && <Badge tone="neutral">draft</Badge>}
                      {node.reviewDecision === "APPROVED" && <Badge tone="added">approved</Badge>}
                      {node.reviewDecision === "CHANGES_REQUESTED" && <Badge tone="danger">changes requested</Badge>}
                      {node.mergeStateStatus === "DIRTY" && <Badge tone="danger">conflicts</Badge>}
                      {node.mergeStateStatus === "BEHIND" && <Badge tone="queue">behind</Badge>}
                      {node.isInMergeQueue && <Badge tone="queue">in merge queue</Badge>}
                      {node.childNumbers.length > 1 && <Badge tone="neutral">{node.childNumbers.length} children</Badge>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {plan && onMerge && (
          <section className="summary-card stack-merge-card">
            <div className="insight-heading">
              <h3>
                <GitMerge size={15} /> Merge plan
              </h3>
              <label className="stack-merge-method">
                Method
                <select value={method} onChange={(event) => setMethod(event.target.value as StackMergeMethod)} disabled={merging} title="Merge method passed to gh pr merge">
                  <option value="squash">squash</option>
                  <option value="merge">merge commit</option>
                  <option value="rebase">rebase</option>
                </select>
              </label>
            </div>
            <p className="muted">Bottom-up: the root merges first, GitHub retargets its children, then each child is restacked and merged in turn.</p>
            {plan.mergeQueueActive && (
              <p className="stack-merge-hint">
                <Badge tone="queue">merge queue active</Badge> A PR in this stack is already queued; let the queue finish before merging more.
              </p>
            )}
            <ol className="stack-merge-steps">
              {plan.steps.map((step) => (
                <li key={step.number} className={`${step.ready ? "ready" : "blocked"} ${step.isCurrent ? "current" : ""}`} title={step.blockers.join(", ") || "Ready to merge"}>
                  <span className="stack-step-title">
                    #{step.number} {step.title}
                  </span>
                  {step.ready ? <Badge tone="added">ready</Badge> : <Badge tone="review-needed">{step.blockers[0]}</Badge>}
                  {step.blockers.length > 1 && <em className="stack-step-more">+{step.blockers.length - 1} more</em>}
                  {step.isNext && (
                    <button
                      type="button"
                      className="primary"
                      disabled={merging || busy}
                      onClick={() => {
                        if (window.confirm(`Merge #${step.number} into ${stack.trunk} using ${method}?\n\nThe PR branch will be deleted so GitHub retargets the child PRs. This cannot be undone from MNLens.`)) onMerge(step.number, method);
                      }}
                    >
                      {merging ? "Merging..." : `Merge #${step.number}`}
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {currentStep && !currentStep.ready && !currentStep.isNext && <p className="muted stack-merge-hint">This PR waits for: {currentStep.blockers.join(", ")}.</p>}
            {!nextStep && <p className="muted stack-merge-hint">Nothing in the stack is mergeable right now.</p>}
            {mergeError && <p className="stack-merge-error">{mergeError}</p>}
          </section>
        )}
      </div>

      {preview}
    </section>
  );
}

function relativeMinutes(iso: string): string {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return "unknown";
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes === 0) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
