import { requireAuth } from "@/lib/auth";
import { badRequest, isUuid, json, notFound, readJson } from "@/lib/http";
import { one } from "@/lib/db";
import { emit } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const TYPES = { paused: "paused", resumed: "active", ended: "ended" } as const;

export async function POST(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const body = await readJson<{ type?: string; audio_position_ms?: number }>(req);
  if (!body || !body.type || !(body.type in TYPES)) return badRequest("type must be paused|resumed|ended");
  const type = body.type as keyof typeof TYPES;
  const pos = typeof body.audio_position_ms === "number" ? Math.max(0, Math.floor(body.audio_position_ms)) : null;
  const row = await one<{ id: string; queue_item_id: string; status: string; audio_position_ms: number; ended_at: string | null }>(
    `UPDATE conversations SET status = $2, audio_position_ms = COALESCE($3, audio_position_ms),
       ended_at = CASE WHEN $2 = 'ended' THEN now() ELSE ended_at END
     WHERE id = $1 RETURNING id, queue_item_id, status, audio_position_ms, ended_at`,
    [id, TYPES[type], pos],
  );
  if (!row) return notFound();
  await emit(`conversation.${type}`, { id: row.id, queue_item_id: row.queue_item_id, audio_position_ms: row.audio_position_ms, status: row.status, ended_at: row.ended_at });
  return json({ ok: true, status: row.status });
}
