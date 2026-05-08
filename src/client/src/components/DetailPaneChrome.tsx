import { AlertTriangle, GitPullRequest } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./uiBits";
import "./detailPaneChrome.css";

export function DetailPaneChrome({
  activeWorkCount,
  children,
  error,
  hasSelection,
  notice,
  onOpenQueue
}: {
  activeWorkCount: number;
  children: ReactNode;
  error?: string;
  hasSelection: boolean;
  notice?: string;
  onOpenQueue: () => void;
}) {
  return (
    <section className="detail-pane">
      {hasSelection && (
        <button className="mobile-queue-toggle" onClick={onOpenQueue}>
          <GitPullRequest size={16} />
          Review queue
          {activeWorkCount > 0 && <Badge tone="queue">{activeWorkCount} active</Badge>}
        </button>
      )}
      {error && (
        <div className="error-banner">
          <AlertTriangle size={18} />
          <pre>{error}</pre>
        </div>
      )}
      {notice && <div className="notice-banner">{notice}</div>}
      {hasSelection ? children : <EmptyState />}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <GitPullRequest size={32} />
      <p>Select a PR from the queue.</p>
    </div>
  );
}
