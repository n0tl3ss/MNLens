import { useEffect, useRef } from "react";
import type { FixJob, Job, VerificationJob } from "../../shared/types";
import { eventStreamUrl } from "./api";

/**
 * Subscribes to the server's SSE stream so job updates arrive as they happen.
 * Polling stays in place as a fallback; when the stream is connected the UI
 * simply gets the same objects earlier.
 */
export function useServerEvents(handlers: { onAnalysis?: (job: Job) => void; onFix?: (job: FixJob) => void; onVerification?: (job: VerificationJob) => void }) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let source: EventSource | undefined;
    let cancelled = false;
    let retry = 1000;
    let timer: number | undefined;

    const connect = async () => {
      try {
        const url = await eventStreamUrl();
        if (cancelled) return;
        source = new EventSource(url);
        source.addEventListener("ready", () => {
          retry = 1000;
        });
        source.addEventListener("analysis", (event) => ref.current.onAnalysis?.(JSON.parse((event as MessageEvent).data) as Job));
        source.addEventListener("fix", (event) => ref.current.onFix?.(JSON.parse((event as MessageEvent).data) as FixJob));
        source.addEventListener("verification", (event) => ref.current.onVerification?.(JSON.parse((event as MessageEvent).data) as VerificationJob));
        source.onerror = () => {
          source?.close();
          source = undefined;
          if (cancelled) return;
          timer = window.setTimeout(() => void connect(), retry);
          retry = Math.min(retry * 2, 30_000);
        };
      } catch {
        if (!cancelled) timer = window.setTimeout(() => void connect(), retry);
      }
    };
    void connect();
    return () => {
      cancelled = true;
      source?.close();
      if (timer) window.clearTimeout(timer);
    };
  }, []);
}
