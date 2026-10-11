import { EventEmitter } from "node:events";
import type express from "express";

/**
 * Server-sent events.
 *
 * Job state (analysis, fix, verification) used to reach the UI only through
 * polling. Every job update now also publishes an event; the client keeps
 * polling as a fallback but reacts instantly when connected. Payloads are the
 * same objects the REST endpoints return, so no new client model is needed.
 */
export type MnlensEventType = "analysis" | "fix" | "verification" | "notice";

interface MnlensEvent {
  type: MnlensEventType;
  payload: unknown;
}

const bus = new EventEmitter();
bus.setMaxListeners(100);
const pending = new Map<string, MnlensEvent>();
let flushTimer: NodeJS.Timeout | undefined;

/** Publish an event; bursts for the same job id within ~150ms coalesce into the latest payload. */
export function publishEvent(type: MnlensEventType, payload: unknown, key?: string): void {
  const dedupeKey = `${type}:${key ?? Math.random().toString(36)}`;
  pending.set(dedupeKey, { type, payload });
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    const events = [...pending.values()];
    pending.clear();
    for (const event of events) bus.emit("event", event);
  }, 150);
}

export function subscribeEvents(listener: (event: MnlensEvent) => void): () => void {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}

export function eventStreamHandler(req: express.Request, res: express.Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  const unsubscribe = subscribeEvents((event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 25_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
