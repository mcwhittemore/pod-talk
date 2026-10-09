import { requireAuth } from "@/lib/auth";
import { badRequest, isUuid, json, notFound, readJson } from "@/lib/http";
import { query } from "@/lib/db";
import { getQueueItem } from "@/lib/queue";
import { emit } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const STATUSES = ["queued", "downloaded", "transcribed", "listening", "done"];

export async function GET(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const item = await getQueueItem(id);
  return item ? json(item) : notFound();
}

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const body = await readJson<{ status?: string; duration_ms?: number }>(req);
  if (!body) return badRequest("invalid json");
  if (body.status !== undefined && !STATUSES.includes(body.status)) return badRequest("invalid status");
  if (body.duration_ms !== undefined && (typeof body.duration_ms !== "number" || body.duration_ms < 0)) {
    return badRequest("duration_ms must be a non-negative number");
  }
  const rows = await query(
    `UPDATE queue_items SET status = COALESCE($2, status), duration_ms = COALESCE($3, duration_ms), updated_at = now()
     WHERE id = $1 RETURNING id`,
    [id, body.status ?? null, body.duration_ms ?? null],
  );
  if (rows.length === 0) return notFound();
  const item = await getQueueItem(id);
  await emit("queue.item.updated", item);
  return json(item);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const rows = await query("DELETE FROM queue_items WHERE id = $1 RETURNING id", [id]);
  return rows.length ? json({ ok: true }) : notFound();
}
