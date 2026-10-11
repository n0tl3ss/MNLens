import { FolderGit2, Loader2, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { TeamStatus } from "../../../shared/types";
import { Badge } from "./uiBits";
import "./agentSettings.css";

/**
 * Team sharing: point MNLens at a folder the team already shares (a git
 * checkout, Dropbox / iCloud, a network drive). Repo rules and review memory
 * are then read from and written to that folder, so one reviewer's verdicts
 * calibrate everyone's agent runs. Memory files are per machine, so nobody
 * overwrites anybody. Rules committed in the repository itself
 * (`.mnlens/review-rules.json`) are picked up without any of this.
 */
export function TeamDialog({ status, saving, error, onClose, onSave }: { status?: TeamStatus; saving: boolean; error?: string; onClose: () => void; onSave: (dir: string | null) => void }) {
  const [dir, setDir] = useState(status?.dir ?? "");
  useEffect(() => setDir(status?.dir ?? ""), [status?.dir]);
  const envManaged = status?.source === "env";
  return (
    <div className="agent-settings-backdrop" role="dialog" aria-modal="true" aria-label="Team sharing" onClick={onClose}>
      <div className="agent-settings" onClick={(event) => event.stopPropagation()}>
        <header>
          <h3>
            <Users size={18} /> Team sharing
          </h3>
          <button type="button" className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </header>

        <section className="agent-settings-section">
          <h4>Shared folder</h4>
          <p className="muted">
            Repo rules and 👍/👎 review memory are stored per machine by default. Point MNLens at a folder your team already syncs (a git checkout, Dropbox, iCloud Drive, a network share) and everyone's verdicts calibrate everyone's analyses. Each machine writes its own memory file, so nothing is overwritten.
          </p>
          {!status ? (
            <p className="muted">
              <Loader2 size={14} className="spin" /> Loading...
            </p>
          ) : (
            <>
              <label className="team-folder">
                <span>Folder</span>
                <input type="text" value={dir} placeholder="/Users/you/Shared/mnlens-team" onChange={(event) => setDir(event.target.value)} disabled={envManaged || saving} spellCheck={false} />
              </label>
              <div className="team-status">
                {status.dir ? (
                  <>
                    {status.exists ? <Badge tone="added">folder found</Badge> : <Badge tone="danger">folder missing</Badge>}
                    {status.exists && (status.writable ? <Badge tone="added">writable</Badge> : <Badge tone="review-needed">read-only</Badge>)}
                    {envManaged && <Badge tone="neutral">set by MNLENS_TEAM_DIR</Badge>}
                    <span className="muted">
                      {status.repositories.length} repositor{status.repositories.length === 1 ? "y" : "ies"} shared · you are <code>{status.memberId}</code>
                    </span>
                  </>
                ) : (
                  <Badge tone="neutral">local only</Badge>
                )}
                {status.error && <span className="agent-settings-error">{status.error}</span>}
              </div>
              {status.repositories.length > 0 && (
                <p className="muted team-repos">
                  Shared: {status.repositories.join(", ")}
                </p>
              )}
            </>
          )}
          {error && <p className="agent-settings-error">{error}</p>}
        </section>

        <section className="agent-settings-section">
          <h4>
            <FolderGit2 size={15} /> Rules committed in the repository
          </h4>
          <p className="muted">
            Maintainers can also commit <code>.mnlens/review-rules.json</code> to the repository. MNLens reads it from the default branch for every reviewer, applies it to Deep Analyze and the review draft, and shows those rules as <Badge tone="label">repo file</Badge>. Use <em>Copy as .mnlens/review-rules.json</em> under Overview → Repository rules to produce the file from your current rules.
          </p>
        </section>

        <footer>
          <button type="button" className="ghost" onClick={onClose} disabled={saving}>
            Close
          </button>
          {status?.dir && !envManaged && (
            <button type="button" className="ghost" onClick={() => onSave(null)} disabled={saving}>
              Stop sharing
            </button>
          )}
          <button type="button" className="primary" onClick={() => onSave(dir.trim())} disabled={saving || envManaged || !dir.trim() || dir.trim() === status?.dir}>
            {saving ? "Saving..." : "Use this folder"}
          </button>
        </footer>
      </div>
    </div>
  );
}
