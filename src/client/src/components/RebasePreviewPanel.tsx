import { GitPullRequest, Loader2 } from "lucide-react";
import type { RebasePrResponse } from "../../../shared/types";
import { cleanConsoleOutput } from "../verificationHelpers";
import { PreparedDiff } from "./PreparedDiff";
import "./rebasePreview.css";

export function RebasePreviewPanel({
  preview,
  busy,
  onApprove,
  onDiscard
}: {
  preview: RebasePrResponse;
  busy: boolean;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  const log = cleanConsoleOutput([preview.stderr, preview.stdout].filter(Boolean).join("\n\n"));
  const strategy = preview.strategy === "merge" ? "merge" : "rebase";
  const title = strategy === "merge" ? "Merge Preview" : "Rebase Preview";
  return (
    <section className="rebase-preview">
      <div className="panel-title">
        <div>
          <h3>{title}</h3>
          <p className="muted">
            Target <b>{preview.defaultBranch}</b>
            {preview.conflictsResolved ? `, ${preview.conflictsResolved} conflict step${preview.conflictsResolved === 1 ? "" : "s"} resolved` : ""}.
            {strategy === "merge"
              ? " Nothing has been pushed; approving will push the merge commit to the PR branch."
              : " Nothing has been pushed and the PR target has not changed yet."}
          </p>
          {preview.strategyReason && <p className="muted">MNLens chose {strategy}: {preview.strategyReason}</p>}
        </div>
        <div className="rebase-preview-actions">
          <button disabled={busy} onClick={onDiscard}>
            Discard preview
          </button>
          <button disabled={busy} onClick={onApprove}>
            {busy ? <Loader2 size={16} className="spin" /> : <GitPullRequest size={16} />}
            Approve {strategy} and push
          </button>
        </div>
      </div>
      {preview.repoDir && <p className="muted">{preview.repoDir}</p>}
      {preview.diff?.trim() ? (
        <PreparedDiff diff={preview.diff} />
      ) : (
        <p className="muted">No code diff was produced by the {strategy}. Review the log before approving.</p>
      )}
      {log && (
        <details>
          <summary>{title} log</summary>
          <pre>{log}</pre>
        </details>
      )}
    </section>
  );
}
