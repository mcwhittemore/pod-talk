import { requireAuth } from "@/lib/auth";
import { badRequest, int32, isUuid, json, readJson } from "@/lib/http";
import { one } from "@/lib/db";
import { listConversations } from "@/lib/conversations";
import { emit } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const qid = new URL(req.url).searchParams.get("queue_item_id");
  if (qid && !isUuid(qid)) return badRequest("queue_item_id must be a uuid");
  return json({ conversations: await listConversations(qid) });
}

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = await readJson<{ queue_item_id?: string; audio_position_ms?: number }>(req);
  if (!body || !isUuid(body.queue_item_id)) return badRequest("queue_item_id must be a uuid");
  const pos = int32(body.audio_position_ms);
  if (pos === undefined) return badRequest("audio_position_ms must be a non-negative integer");
  const item = await one<{ id: string; title: string }>("SELECT id, title FROM queue_items WHERE id = $1", [body.queue_item_id]);
  if (!item) return badRequest("queue item not found");
  const row = await one<{ id: string; started_at: string }>(
    `INSERT INTO conversations (queue_item_id, audio_position_ms) VALUES ($1, $2) RETURNING id, started_at`,
    [item.id, pos ?? 0],
  );
  if (!row) return badRequest("insert failed");
  await one("UPDATE queue_items SET status = 'listening', updated_at = now() WHERE id = $1 AND status <> 'done'", [item.id]);
  emit("conversation.started", {
    id: row.id, queue_item_id: item.id, queue_item_title: item.title, audio_position_ms: pos ?? 0, started_at: row.started_at,
  });
  return json({ id: row.id }, 201);
}
