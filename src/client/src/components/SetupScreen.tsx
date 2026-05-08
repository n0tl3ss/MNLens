import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react";
import type { AuthStatus, SetupStatus } from "../../../shared/types";
import "./setup.css";

export function SetupScreen({
  status,
  auth,
  loading,
  error,
  token,
  savingToken,
  betaLimitations,
  onRefresh,
  onRefreshAuth,
  onTokenChange,
  onSaveToken,
  onContinue
}: {
  status?: SetupStatus;
  auth?: AuthStatus;
  loading: boolean;
  error?: string;
  token: string;
  savingToken: boolean;
  betaLimitations: string[];
  onRefresh: () => void;
  onRefreshAuth: () => void;
  onTokenChange: (token: string) => void;
  onSaveToken: () => void;
  onContinue: () => void;
}) {
  const missingRequired = status?.dependencies.filter((item) => item.required && !item.installed) ?? [];
  const missingRecommended = status?.dependencies.filter((item) => !item.required && !item.installed) ?? [];
  const visibleDependencies = status?.dependencies ?? setupDependencyPlaceholders();
  const githubReady = Boolean(auth?.ghAuthenticated);
  const canContinue = Boolean(status?.ready) && githubReady && !loading && !savingToken;
  return (
    <main className="setup-shell">
      <section className="setup-panel">
        <div className="setup-heading">
          <div className="setup-brand">
            <img src="/mnlens-logo.png?v=5" alt="" />
            <div>
              <p className="eyebrow">First-time setup</p>
              <h1>Set up MNLens</h1>
            </div>
            <p>
              MNLens runs GitHub, Git, Codex, and verification commands on this machine. Fix required tools before reviewing PRs.
            </p>
          </div>
          {loading ? <Loader2 size={28} className="spin" /> : status?.ready ? <CheckCircle2 size={28} /> : <AlertTriangle size={28} />}
        </div>

        {error && (
          <div className="error-banner">
            <AlertTriangle size={18} />
            <pre>{error}</pre>
          </div>
        )}

        <div className="setup-grid">
          {visibleDependencies.map((item) => {
            const checking = loading && !status;
            return (
              <article key={item.id} className={`setup-check ${checking ? "checking" : item.installed ? "ok" : item.required ? "missing" : "warn"}`}>
                <div className="setup-check-title">
                  {checking ? <Loader2 size={18} className="spin" /> : item.installed ? <CheckCircle2 size={18} /> : item.required ? <X size={18} /> : <AlertTriangle size={18} />}
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.required ? "required" : "recommended"}</span>
                  </div>
                </div>
                {checking ? (
                  <p>Checking availability and authentication...</p>
                ) : item.installed ? (
                  <p>{item.version ?? "Installed"}</p>
                ) : (
                  <>
                    {item.details && <p>{item.details}</p>}
                    {item.installHint && <pre>{item.installHint}</pre>}
                  </>
                )}
              </article>
            );
          })}
          {!status && !loading && !error && <p className="empty">No setup status returned yet.</p>}
        </div>

        <GitHubSetupCard
          auth={auth}
          token={token}
          saving={savingToken}
          onTokenChange={onTokenChange}
          onSave={onSaveToken}
          onRefresh={onRefreshAuth}
        />

        <section className="beta-limitations">
          <div>
            <strong>Beta limitations</strong>
            <p>MNLens keeps review control local and human-approved.</p>
          </div>
          <ul>
            {(betaLimitations.length > 0 ? betaLimitations : defaultBetaLimitations()).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <div className="setup-summary">
          {loading && <span>Checking tools...</span>}
          {!loading && missingRequired.length > 0 && <span>{plural(missingRequired.length, "required tool")} missing.</span>}
          {!loading && missingRequired.length === 0 && !githubReady && <span>GitHub authentication is required before PR data can be loaded.</span>}
          {!loading && missingRequired.length === 0 && githubReady && auth?.scopeCheck === "limited" && <span>GitHub is authenticated with public repository access. Private repositories and some push workflows may need a fine-grained token or classic `repo`.</span>}
          {!loading && missingRequired.length === 0 && githubReady && auth?.scopeCheck === "missing" && <span>GitHub is authenticated, but token permissions look too narrow for repository review workflows.</span>}
          {!loading && missingRequired.length === 0 && missingRecommended.length > 0 && <span>{plural(missingRecommended.length, "recommended tool")} missing. You can continue, but some local verification may need manual setup later.</span>}
          {!loading && status?.ready && githubReady && missingRecommended.length === 0 && <span>All local review tools are ready.</span>}
        </div>

        <div className="setup-actions">
          <button onClick={onRefresh} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            Check again
          </button>
          <button onClick={onContinue} disabled={!canContinue}>
            Continue to reviews
          </button>
        </div>
      </section>
    </main>
  );
}

function setupDependencyPlaceholders(): SetupStatus["dependencies"] {
  return [
    { id: "git", name: "Git", required: true, installed: false, installHint: "" },
    { id: "gh", name: "GitHub CLI", required: true, installed: false, installHint: "" },
    { id: "codex", name: "Codex CLI", required: true, installed: false, installHint: "" },
    { id: "codex-auth", name: "Codex authentication", required: true, installed: false, installHint: "" },
    { id: "secure-store", name: "Secure credential store", required: true, installed: false, installHint: "" }
  ];
}

function GitHubSetupCard({
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
  if (!auth) {
    return (
      <article className="setup-auth-card checking">
        <div className="setup-check-title">
          <Loader2 size={18} className="spin" />
          <div>
            <strong>GitHub authentication</strong>
            <span>required</span>
          </div>
        </div>
        <p>Checking GitHub CLI authentication...</p>
      </article>
    );
  }
  if (auth.ghAuthenticated) {
    const warning = auth.scopeCheck === "missing" || auth.scopeCheck === "unknown";
    return (
      <article className={`setup-auth-card ${warning ? "warn" : "ok"}`}>
        <div className="setup-check-title">
          {warning ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <div>
            <strong>GitHub authentication</strong>
            <span>required</span>
          </div>
        </div>
        <p>GitHub CLI is authenticated{auth.username ? ` as ${auth.username}` : ""}.</p>
        <GitHubTokenPermissions auth={auth} compact={auth.scopeCheck === "ok" || auth.scopeCheck === "limited"} />
      </article>
    );
  }

  const storeName = secureStoreName(auth.tokenStore);
  return (
    <article className="setup-auth-card missing">
      <div className="setup-check-title">
        <ShieldAlert size={18} />
        <div>
          <strong>GitHub authentication</strong>
          <span>required</span>
        </div>
      </div>
      <p>Save a GitHub PAT in {storeName}, or complete the manual setup shown below. The token is stored in the OS secure store and passed only to `gh` for local API calls.</p>
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
    </article>
  );
}

export function GitHubTokenPermissions({ auth, compact = false }: { auth: AuthStatus; compact?: boolean }) {
  const scopes = auth.tokenScopes ?? [];
  const missing = auth.missingScopes ?? [];
  return (
    <div className={`auth-scopes ${auth.scopeCheck ?? "unknown"}`}>
      <strong>GitHub token permissions</strong>
      {!compact && (
        <ul>
          <li>Preferred: fine-grained PAT scoped only to the repositories you review.</li>
          <li>Read/review mode: Metadata read, Contents read, Pull requests read, Issues read, Actions read, Checks read, Commit statuses read, and Projects read for GitHub Project dropdowns.</li>
          <li>Write actions: add Pull requests write to submit reviews, Issues write to comment, Contents write only when pushing approved fixes or rebases, and Projects write to attach PRs/issues to GitHub Projects.</li>
          <li>Classic token Projects support: add <code>read:project</code> to list organization Projects and <code>project</code> to attach PRs/issues.</li>
          <li>Classic fallback: <code>public_repo</code> is enough for public-repo workflows; <code>repo</code> is only needed for private repositories or broad classic-token access.</li>
        </ul>
      )}
      {auth.scopeCheck === "ok" && <p>Detected full classic repository scope: {scopes.map((scope) => <code key={scope}>{scope}</code>)}</p>}
      {auth.scopeCheck === "limited" && <p>Detected public repository classic scope: {scopes.map((scope) => <code key={scope}>{scope}</code>)}. This is fine for public repositories; use a fine-grained token for least-privilege private access.</p>}
      {auth.scopeCheck === "missing" && (
        <p>
          Token is authenticated, but it does not advertise a repository scope MNLens recognizes for the full workflow{missing.length > 0 ? <>: {missing.map((scope) => <code key={scope}>{scope}</code>)}</> : "."}
        </p>
      )}
      {auth.scopeCheck === "unknown" && (
        <p>
          MNLens could not read classic OAuth scopes. This is common for fine-grained PATs; verify the fine-grained permissions above.
        </p>
      )}
      {auth.scopeHint && (
        <details>
          <summary>Permission details</summary>
          <pre>{auth.scopeHint}</pre>
        </details>
      )}
    </div>
  );
}

export function secureStoreName(store: AuthStatus["tokenStore"]): string {
  if (store === "macos-keychain") return "macOS Keychain";
  if (store === "windows-credential-manager") return "Windows Credential Manager";
  if (store === "linux-secret-service") return "Linux Secret Service/libsecret";
  return "a supported secure store";
}

function defaultBetaLimitations(): string[] {
  return [
    "MNLens is a local review assistant and should not be exposed on a network.",
    "Queued or running analysis, verification, and Codex jobs should be rerun after app restart.",
    "Codex prepares code changes only; a human must inspect and approve before commit or push."
  ];
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
