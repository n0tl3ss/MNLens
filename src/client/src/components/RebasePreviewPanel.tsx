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
  return (
    <section className="rebase-preview">
      <div className="panel-title">
        <div>
          <h3>Rebase Preview</h3>
          <p className="muted">
            Target <b>{preview.defaultBranch}</b>
            {preview.conflictsResolved ? `, ${preview.conflictsResolved} conflict step${preview.conflictsResolved === 1 ? "" : "s"} resolved` : ""}.
            Nothing has been pushed and the PR target has not changed yet.
          </p>
        </div>
        <div className="rebase-preview-actions">
          <button disabled={busy} onClick={onDiscard}>
            Discard preview
          </button>
          <button disabled={busy} onClick={onApprove}>
            {busy ? <Loader2 size={16} className="spin" /> : <GitPullRequest size={16} />}
            Approve rebase and push
          </button>
        </div>
      </div>
      {preview.repoDir && <p className="muted">{preview.repoDir}</p>}
      {preview.diff?.trim() ? (
        <PreparedDiff diff={preview.diff} />
      ) : (
        <p className="muted">No code diff was produced by the rebase. Review the log before approving.</p>
      )}
      {log && (
        <details>
          <summary>Rebase log</summary>
          <pre>{log}</pre>
        </details>
      )}
    </section>
  );
}
