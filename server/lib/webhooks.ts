import { createHmac, randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { one, query } from "./db";

export const WEBHOOK_EVENTS = [
  "queue.item.added",
  "queue.item.updated",
  "transcript.synced",
  "conversation.started",
  "conversation.paused",
  "conversation.resumed",
  "conversation.ended",
  "question.created",
  "response.created",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "webhook.test";

interface WebhookRow {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
}

export interface DeliveryRow {
  id: string;
  event: string;
  status_code: number | null;
  ok: boolean;
  error: string | null;
  created_at: string;
}

export function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** POSTs one event to one webhook and logs the result. Returns the webhook_deliveries row. */
export async function deliver(hook: WebhookRow, event: WebhookEvent, data: unknown): Promise<DeliveryRow | null> {
  const payload = { id: randomUUID(), event, created_at: new Date().toISOString(), data };
  const body = JSON.stringify(payload);
  let statusCode: number | null = null;
  let ok = false;
  let error: string | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-podtalk-event": event,
        "x-podtalk-signature": sign(hook.secret ?? "", body),
        "x-podtalk-delivery": payload.id,
      },
      body,
      signal: controller.signal,
    });
    statusCode = res.status;
    ok = res.ok;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e);
  } finally {
    clearTimeout(timer);
  }
  return one<DeliveryRow>(
    `INSERT INTO webhook_deliveries (webhook_id, event, payload, status_code, ok, error)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, event, status_code, ok, error, created_at`,
    [hook.id, event, body, statusCode, ok, error],
  );
}

/** Deliver an event to every active webhook subscribed to it and wait for the results. Never throws. */
export async function emitAndWait(event: WebhookEvent, data: unknown): Promise<void> {
  try {
    const hooks = await query<WebhookRow>(
      `SELECT id, url, secret, events, active FROM webhooks
       WHERE active AND (cardinality(events) = 0 OR $1 = ANY(events))`,
      [event],
    );
    await Promise.all(hooks.map((h) => deliver(h, event, data)));
  } catch (e) {
    console.error("webhook emit failed", event, e);
  }
}

/**
 * Deliver an event without blocking the request. On Vercel, `waitUntil` keeps the function alive
 * until delivery finishes; elsewhere (next dev) it is a no-op and the promise simply runs detached.
 */
export function emit(event: WebhookEvent, data: unknown): void {
  const p = emitAndWait(event, data).catch((e) => console.error("webhook emit failed", event, e));
  try {
    waitUntil(p);
  } catch {
    /* no request context (e.g. local dev); the promise still runs */
  }
}
