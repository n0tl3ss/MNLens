import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import type { AuthStatus } from "../../../shared/types";
import { GitHubTokenPermissions, secureStoreName } from "./SetupScreen";
import "./setup.css";

export function AuthBanner({
  auth,
  token,
  saving,
  onTokenChange,
  onSave,
  onRefresh
}: {
  auth?: AuthStatus;
  token: string;
  saving: boolean;
  onTokenChange: (token: string) => void;
  onSave: () => void;
  onRefresh: () => void;
}) {
  if (!auth) return null;
  if (auth.ghAuthenticated) {
    const warning = auth.scopeCheck === "missing" || auth.scopeCheck === "unknown";
    const rate = rateLimitLabel(auth);
    return (
      <div className={`auth ${warning ? "warn" : "ok"}`}>
        {warning ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
        <span>
          GitHub token active{auth.username ? ` as ${auth.username}` : ""}
          {auth.scopeCheck === "unknown" ? " - verify fine-grained token permissions" : ""}
          {auth.scopeCheck === "limited" ? " - public repository scope" : ""}
          {auth.scopeCheck === "missing" ? " - limited token permissions" : ""}
        </span>
        {rate && <span className={`auth-rate-limit ${rate.tone}`}>{rate.label}</span>}
      </div>
    );
  }
  const storeName = secureStoreName(auth.tokenStore);
  return (
    <div className="auth warn setup">
      <ShieldAlert size={18} />
      <div className="auth-setup-body">
        <div>
          <strong>Connect GitHub</strong>
          <p>
            Save a GitHub PAT in {storeName}. The token stays in the OS secure store and is only passed to `gh` for local API calls.
          </p>
        </div>
        <GitHubTokenPermissions auth={auth} />
        <label className="auth-token-field">
          <span>GitHub token</span>
          <input
            type="password"
            autoComplete="off"
            value={token}
            disabled={!auth.setupSupported || saving}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder="ghp_..."
          />
        </label>
        <div className="auth-actions">
          <button disabled={!auth.setupSupported || saving || token.trim().length === 0} onClick={onSave}>
            {saving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
            Save token securely
          </button>
          <button onClick={onRefresh} disabled={saving}>
            <RefreshCw size={16} />
            Check again
          </button>
        </div>
        {auth.error && <pre>{auth.error}</pre>}
        <details className="auth-hint">
          <summary>Manual setup</summary>
          <pre>{auth.setupHint}</pre>
        </details>
      </div>
    </div>
  );
}

function rateLimitLabel(auth: AuthStatus): { label: string; tone: "ok" | "warn" | "danger" } | undefined {
  const rate = auth.githubRateLimit;
  if (!rate) return { label: "GitHub API limit unknown", tone: "warn" };
  if (rate.limited) {
    const reset = rate.until ? new Date(rate.until).toLocaleTimeString() : rate.resetAt ? new Date(rate.resetAt).toLocaleTimeString() : "later";
    return { label: `GitHub rate limited until ${reset}`, tone: "danger" };
  }
  if (typeof rate.remaining !== "number" || typeof rate.limit !== "number") return { label: "GitHub API limit checking", tone: "warn" };
  const reset = rate.resetAt ? `, resets ${new Date(rate.resetAt).toLocaleTimeString()}` : "";
  const ratio = rate.limit > 0 ? rate.remaining / rate.limit : 1;
  return {
    label: `GitHub API ${rate.remaining}/${rate.limit} left${reset}`,
    tone: ratio < 0.1 ? "danger" : ratio < 0.25 ? "warn" : "ok"
  };
}
