import { Clipboard, Send } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * One structured, human-edited comment for the PR author: acceptance-criteria
 * status with evidence, the findings the reviewer kept, second-opinion notes
 * and local verification runs. Nothing is posted until the reviewer clicks Post.
 */
export function AuthorFeedbackSection({
  preview,
  busy,
  error,
  selfReview = false,
  onPreview,
  onPost
}: {
  preview?: string;
  busy?: boolean;
  error?: string;
  selfReview?: boolean;
  onPreview: (note: string) => void;
  onPost: (body: string) => void;
}) {
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState(preview ?? "");
  useEffect(() => setDraft(preview ?? ""), [preview]);
  return (
    <section className="summary-card handoff-card">
      <div className="panel-title">
        <div>
          <h3>{selfReview ? "Notes for my reviewers" : "Feedback To Author"}</h3>
          <p className="muted">
            {selfReview
              ? "One comment on your PR with what you checked: acceptance criteria and their evidence, the findings you kept, second-opinion notes and local runs."
              : "One structured comment for the PR author: acceptance-criteria status with evidence, the findings you kept (👍), second-opinion notes, and your local verification runs. Nothing is posted until you click Post."}
          </p>
        </div>
      </div>
      <label className="handoff-note">
        <span>{selfReview ? "Optional note for reviewers" : "Optional note to the author"}</span>
        <input type="text" value={note} onChange={(event) => setNote(event.target.value)} placeholder={selfReview ? "e.g. Please focus on the retry path." : "e.g. Approving once the retry test lands."} />
      </label>
      <div className="inline-actions">
        <button type="button" onClick={() => onPreview(note)} disabled={busy}>
          {busy && !draft ? "Building..." : draft ? "Rebuild preview" : "Build comment preview"}
        </button>
        {draft && (
          <>
            <button type="button" onClick={() => void navigator.clipboard.writeText(draft)}>
              <Clipboard size={16} />
              Copy
            </button>
            <button type="button" className="primary" onClick={() => onPost(draft)} disabled={busy || !draft.trim()} title="Posts this comment to the PR conversation with your GitHub identity">
              <Send size={16} />
              {busy ? "Posting..." : "Post to PR"}
            </button>
          </>
        )}
      </div>
      {draft && <textarea className="handoff-text" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />}
      {error && <p className="acceptance-error">{error}</p>}
    </section>
  );
}
