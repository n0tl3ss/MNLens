import { useEffect, useRef } from "react";

type PollableJob = {
  id: string;
  status: string;
};

export function useJobPolling<T extends PollableJob>(
  jobs: Record<string, T>,
  pollJob: (id: string) => void | Promise<void>,
  intervalMs: number
) {
  const pollRef = useRef(pollJob);

  useEffect(() => {
    pollRef.current = pollJob;
  }, [pollJob]);

  useEffect(() => {
    const active = Object.values(jobs).filter((job) => job.status === "queued" || job.status === "running");
    if (active.length === 0) return;

    const timer = window.setInterval(() => {
      active.forEach((job) => void pollRef.current(job.id));
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [jobs, intervalMs]);
}
