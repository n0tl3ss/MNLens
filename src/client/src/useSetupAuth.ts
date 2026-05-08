import { useEffect, useMemo, useState } from "react";
import type { AuthStatus, SetupStatus } from "../../shared/types";
import { getAuthStatus, getLocalSession, getSetupStatus, storeGithubToken } from "./api";

interface UseSetupAuthOptions {
  onError: (message: string | undefined) => void;
  onNotice: (message: string | undefined) => void;
}

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
    const timer = window.setInterval(() => void refreshAuth(), 2 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function refreshAuth() {
    setAuth(await getAuthStatus());
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
    () => setupStatus?.dependencies.filter((item) => item.required && !item.installed) ?? [],
    [setupStatus]
  );
  const githubReady = Boolean(auth?.ghAuthenticated);
  const shouldShowSetup =
    setupLoading ||
    !setupStatus ||
    !auth ||
    missingRequired.length > 0 ||
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
    refreshSetupStatus,
    saveGithubToken,
    setAuthTokenInput,
    continueSetup
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
