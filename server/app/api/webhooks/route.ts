import { requireAuth } from "@/lib/auth";
import { badRequest, json, readJson } from "@/lib/http";
import { query } from "@/lib/db";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const webhooks = await query("SELECT id, url, events, active, created_at FROM webhooks ORDER BY created_at DESC");
  return json({ webhooks, available_events: WEBHOOK_EVENTS });
}

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = await readJson<{ url?: string; secret?: string; events?: unknown; active?: boolean }>(req);
  if (!body || typeof body.url !== "string") return badRequest("url is required");
  try {
    const u = new URL(body.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    return badRequest("url must be a valid http(s) URL");
  }
  const events = Array.isArray(body.events) ? body.events.filter((e): e is string => typeof e === "string") : [];
  const unknown = events.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (unknown.length) return badRequest(`unknown events: ${unknown.join(", ")}`);
  const rows = await query(
    `INSERT INTO webhooks (url, secret, events, active) VALUES ($1, $2, $3, $4) RETURNING id, url, events, active, created_at`,
    [body.url, typeof body.secret === "string" ? body.secret : "", events, body.active ?? true],
  );
  return json(rows[0], 201);
}
