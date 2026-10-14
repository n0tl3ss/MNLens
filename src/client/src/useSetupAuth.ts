import { useEffect, useMemo, useState } from "react";
import type { AuthStatus, SetupStatus } from "../../shared/types";
import { getAuthStatus, getGithubRateLimit, getLocalSession, getSetupStatus, storeGithubToken } from "./api";
import { availableAgentsFrom } from "./setupAgents";

interface UseSetupAuthOptions {
  onError: (message: string | undefined) => void;
  onNotice: (message: string | undefined) => void;
}

/** Full auth re-check (user, scopes, budgets) costs three `gh` calls, so it runs rarely. */
const authRefreshMs = 10 * 60_000;
/** `gh api rate_limit` is free, so the budget chip can follow real consumption closely. */
const rateLimitRefreshMs = 60_000;

export function useSetupAuth({ onError, onNotice }: UseSetupAuthOptions) {
  const [auth, setAuth] = useState<AuthStatus | undefined>();
  const [setupStatus, setSetupStatus] = useState<SetupStatus | undefined>();
  const [betaLimitations, setBetaLimitations] = useState<string[]>([]);
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupDismissed, setSetupDismissed] = useState(() => localStorage.getItem("pra-setup-dismissed") === "true");
  const [setupError, setSetupError] = useState<string | undefined>();
  const [authTokenInput, setAuthTokenInput] = useState("");
  const [savingAuthToken, setSavingAuthToken] = useState(false);

  useEffect(() => {
    void getLocalSession().then((session) => setBetaLimitations(session.betaLimitations)).catch(() => setBetaLimitations([]));
    void refreshSetupStatus();
    void refreshAuth();
    const authTimer = window.setInterval(() => void refreshAuth(), authRefreshMs);
    const rateTimer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refreshRateLimit();
    }, rateLimitRefreshMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshRateLimit();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(authTimer);
      window.clearInterval(rateTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  async function refreshAuth() {
    setAuth(await getAuthStatus());
  }

  /** Updates only the GitHub budget on the existing auth status; silent on failure so the banner never flickers. */
  async function refreshRateLimit() {
    try {
      const next = await getGithubRateLimit();
      setAuth((current) => (current?.ghAuthenticated ? { ...current, githubRateLimit: next } : current));
    } catch {
      // Keep the last known budget.
    }
  }

  async function refreshSetupStatus() {
    setSetupLoading(true);
    setSetupError(undefined);
    try {
      const status = await getSetupStatus();
      setSetupStatus(status);
    } catch (err) {
      setSetupError(messageOf(err));
    } finally {
      setSetupLoading(false);
    }
  }

  async function saveGithubToken() {
    onError(undefined);
    onNotice(undefined);
    setSavingAuthToken(true);
    try {
      const nextAuth = await storeGithubToken(authTokenInput);
      setAuth(nextAuth);
      setAuthTokenInput("");
      onNotice(nextAuth.ghAuthenticated ? "GitHub token saved securely." : "GitHub token saved. Authentication still needs attention.");
      if (!nextAuth.ghAuthenticated && nextAuth.error) onError(nextAuth.error);
    } catch (err) {
      onError(messageOf(err));
    } finally {
      setSavingAuthToken(false);
    }
  }

  function continueSetup() {
    localStorage.setItem("pra-setup-dismissed", "true");
    setSetupDismissed(true);
  }

  const missingRecommended = useMemo(
    () => setupStatus?.dependencies.filter((item) => !item.required && !item.installed) ?? [],
    [setupStatus]
  );
  const missingRequired = useMemo(
    () => setupStatus?.dependencies.filter((item) => item.required && !item.installed && !item.group) ?? [],
    [setupStatus]
  );
  // At least one coding agent (Codex or Claude Code) must be installed and signed in.
  const noAgentReady = Boolean(setupStatus) && (availableAgentsFrom(setupStatus) ?? []).length === 0;
  const githubReady = Boolean(auth?.ghAuthenticated);
  const shouldShowSetup =
    setupLoading ||
    !setupStatus ||
    !auth ||
    missingRequired.length > 0 ||
    noAgentReady ||
    !githubReady ||
    Boolean(setupError) ||
    (!setupDismissed && missingRecommended.length > 0);

  return {
    auth,
    setupStatus,
    betaLimitations,
    setupLoading,
    setupError,
    authTokenInput,
    savingAuthToken,
    shouldShowSetup,
    refreshAuth,
    refreshRateLimit,
    refreshSetupStatus,
    saveGithubToken,
    setAuthTokenInput,
    continueSetup
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
