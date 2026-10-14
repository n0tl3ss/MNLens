import type { FixJob } from "../../shared/types";

export function fixProgress(phase?: FixJob["phase"]): string {
  if (phase === "preparing") return "15%";
  if (phase === "checking-out") return "30%";
  if (phase === "implementation" || phase === "codex") return "50%";
  if (phase === "tests-qa" || phase === "testing") return "70%";
  if (phase === "final-review") return "90%";
  if (phase === "committing") return "96%";
  if (phase === "pushing") return "95%";
  if (phase === "completed") return "100%";
  return "8%";
}

export function fixPipelineNode(job: FixJob | undefined, pass: string) {
  return job?.pipeline?.find((node) => node.label === pass);
}

export function fixSpecialistState(job: FixJob | undefined, pass: string): "done" | "current" | "pending" | "failed" | "waiting" {
  const node = fixPipelineNode(job, pass);
  if (node) {
    if (job?.status === "failed" && node.status === "current") return "failed";
    return node.status;
  }
  const order = ["Implementation", "Tests/QA", "Final review"];
  const current = fixCurrentSpecialist(job);
  const index = order.indexOf(pass);
  const currentIndex = order.indexOf(current);
  if (!job || job.status === "queued") return "pending";
  if (job.status === "failed") {
    if (pass === current || (current === "" && pass === "Final review")) return "failed";
    return currentIndex >= 0 && index < currentIndex ? "done" : "pending";
  }
  if (job.status === "done" || job.phase === "completed") return "done";
  if (pass === current) return "current";
  if (currentIndex >= 0 && index < currentIndex) return "done";
  return "pending";
}

export function fixCurrentSpecialist(job?: FixJob): string {
  if (!job) return "";
  if (job.phase === "preparing" || job.phase === "checking-out" || job.phase === "implementation" || job.phase === "codex") return "Implementation";
  if (job.phase === "tests-qa" || job.phase === "testing") return "Tests/QA";
  if (job.phase === "final-review" || job.phase === "committing" || job.phase === "pushing") return "Final review";
  if (job.status === "failed") return "Final review";
  return "";
}
