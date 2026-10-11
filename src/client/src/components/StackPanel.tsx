import { ArrowDown, GitBranch, GitMerge, Layers, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { PrStack, PrStackNode, StackMergeMethod, StackMergePlan } from "../../../shared/types";
import { Badge } from "./uiBits";
import "./stackPanel.css";

/**
 * Shows the stack a PR belongs to (root → leaf), the reviewer's position in it,
 * and the "restack" action. Restacking reuses the branch-update preview: for a
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
  onSelect: (node: PrStackNode) => void;
  onRefresh: () => void;
  onRestack: () => void;
  onMerge?: (number: number, method: StackMergeMethod) => void;
}) {
  const [method, setMethod] = useState<StackMergeMethod>("squash");
  if (!stack || !stack.isStacked) return null;
  const nextStep = plan?.steps.find((step) => step.isNext);
  const currentStep = plan?.steps.find((step) => step.isCurrent);
  const parentMerged = Boolean(stack.parent && stack.parent.state !== "OPEN");
  const parentApproved = stack.parent?.reviewDecision === "APPROVED";
  return (
    <section className="stack-panel" aria-label="Pull request stack">
      <header className="stack-panel-header">
        <span className="stack-panel-title">
          <Layers size={16} />
          <strong>Stacked PR</strong>
          <Badge tone="neutral">
            {stack.position} of {stack.chain.length}
          </Badge>
          <span className="stack-trunk">
            <GitBranch size={13} /> trunk <code>{stack.trunk}</code>
          </span>
        </span>
        <span className="stack-panel-actions">
          <button type="button" className="icon-button" onClick={onRefresh} disabled={loading || busy} title="Refresh stack from GitHub">
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
          {stack.parent && (
            <button type="button" onClick={onRestack} disabled={busy} title={`Preview rebasing this PR onto ${stack.parent.headRefName}. Nothing is pushed until you approve.`}>
              Restack onto #{stack.parent.number}
            </button>
          )}
        </span>
      </header>

      <ol className="stack-chain">
        {stack.chain.map((node, index) => {
          const current = node.number === stack.number;
          return (
            <li key={node.number} className={`stack-node ${current ? "current" : ""}`}>
              {index > 0 && <ArrowDown size={12} className="stack-arrow" />}
              <button type="button" className="stack-node-select" onClick={() => !current && onSelect(node)} disabled={current} title={current ? "This PR" : `Open #${node.number}`}>
                <span className="stack-node-number">#{node.number}</span>
                <span className="stack-node-title">{node.title}</span>
                <span className="stack-node-meta">
                  <code>{node.headRefName}</code>
                  {node.isDraft && <Badge tone="neutral">draft</Badge>}
                  {node.reviewDecision === "APPROVED" && <Badge tone="added">approved</Badge>}
                  {node.reviewDecision === "CHANGES_REQUESTED" && <Badge tone="danger">changes requested</Badge>}
                  {node.mergeStateStatus === "DIRTY" && <Badge tone="danger">conflicts</Badge>}
                  {node.mergeStateStatus === "BEHIND" && <Badge tone="review-needed">behind</Badge>}
                  {node.childNumbers.length > 1 && <Badge tone="neutral">{node.childNumbers.length} children</Badge>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {plan && onMerge && (
        <div className="stack-merge-plan">
          <div className="stack-merge-head">
            <strong>
              <GitMerge size={14} /> Merge plan (bottom-up)
            </strong>
            <select value={method} onChange={(event) => setMethod(event.target.value as StackMergeMethod)} disabled={merging} title="Merge method passed to gh pr merge">
              <option value="squash">squash</option>
              <option value="merge">merge commit</option>
              <option value="rebase">rebase</option>
            </select>
            {plan.mergeQueueActive && <Badge tone="queue">merge queue active</Badge>}
          </div>
          <ol className="stack-merge-steps">
            {plan.steps.map((step) => (
              <li key={step.number} className={`${step.ready ? "ready" : "blocked"} ${step.isCurrent ? "current" : ""}`}>
                <span>
                  #{step.number} {step.title}
                </span>
                {step.ready ? <Badge tone="added">ready</Badge> : <Badge tone="review-needed">{step.blockers[0]}</Badge>}
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
        </div>
      )}

      <p className="stack-note muted">
        {stack.parent
          ? parentMerged
            ? `Parent #${stack.parent.number} is no longer open. GitHub retargets this PR to ${stack.trunk} when the parent branch is deleted; re-run Deep Analyze because the diff scope changed.`
            : `This diff is relative to #${stack.parent.number} (${stack.parent.headRefName})${parentApproved ? ", which is approved" : ", which is not approved yet"}. Review only the incremental change; merge parents first, bottom-up.`
          : `This is the root of the stack. ${stack.children.length === 1 ? `#${stack.children[0].number} builds on it.` : `${stack.children.length} PRs build on it.`} Merging or force-pushing here affects the whole stack.`}
      </p>
    </section>
  );
}
