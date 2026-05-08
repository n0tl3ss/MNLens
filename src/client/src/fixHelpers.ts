import type { FixJob } from "../../shared/types";

export function fixProgress(phase?: FixJob["phase"]): string {
  if (phase === "preparing") return "15%";
  if (phase === "checking-out") return "30%";
  if (phase === "research") return "40%";
  if (phase === "implementation" || phase === "codex") return "55%";
  if (phase === "tests-qa" || phase === "testing") return "70%";
  if (phase === "docs") return "80%";
  if (phase === "security") return "88%";
  if (phase === "final-review") return "94%";
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
  const order = ["Research", "Implementation", "Tests/QA", "Docs", "Security", "Final review"];
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
  if (job.phase === "preparing" || job.phase === "checking-out" || job.phase === "research") return "Research";
  if (job.phase === "implementation" || job.phase === "codex") return "Implementation";
  if (job.phase === "tests-qa" || job.phase === "testing") return "Tests/QA";
  if (job.phase === "docs") return "Docs";
  if (job.phase === "security") return "Security";
  if (job.phase === "final-review" || job.phase === "committing" || job.phase === "pushing") return "Final review";
  if (job.status === "failed") return "Final review";
  return "";
}
