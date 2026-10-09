import { requireAuth } from "@/lib/auth";
import { badRequest, int32, isUuid, json, notFound, readJson } from "@/lib/http";
import { one } from "@/lib/db";
import type { Turn } from "@/lib/conversations";
import { emit } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

interface Body {
  role?: string;
  text?: string;
  audio_position_ms?: number;
  segment_start_ms?: number | null;
  segment_end_ms?: number | null;
  context_excerpt?: string | null;
  engine?: string | null;
  client_ts?: string | number | null;
}

export async function POST(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const body = await readJson<Body>(req);
  if (!body) return badRequest("invalid json");
  if (body.role !== "user" && body.role !== "assistant") return badRequest("role must be user|assistant");
  if (typeof body.text !== "string" || !body.text.trim()) return badRequest("text is required");
  const pos = int32(body.audio_position_ms);
  const segStart = int32(body.segment_start_ms);
  const segEnd = int32(body.segment_end_ms);
  if (pos === undefined || segStart === undefined || segEnd === undefined) {
    return badRequest("audio_position_ms, segment_start_ms, segment_end_ms must be non-negative integers");
  }
  const conv = await one<{ id: string; queue_item_id: string }>("SELECT id, queue_item_id FROM conversations WHERE id = $1", [id]);
  if (!conv) return notFound();

  let createdAt: string | null = null;
  if (body.client_ts != null) {
    const d = new Date(body.client_ts);
    if (!Number.isNaN(d.getTime())) createdAt = d.toISOString();
  }
  const turn = await one<Turn>(
    `INSERT INTO turns (conversation_id, role, text, audio_position_ms, segment_start_ms, segment_end_ms, context_excerpt, engine, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now())) RETURNING *`,
    [
      id, body.role, body.text.trim(), pos ?? 0, segStart, segEnd,
      typeof body.context_excerpt === "string" ? body.context_excerpt : null,
      typeof body.engine === "string" ? body.engine : null, createdAt,
    ],
  );
  if (!turn) return badRequest("insert failed");
  await one("UPDATE conversations SET audio_position_ms = $2 WHERE id = $1", [id, turn.audio_position_ms]);
  emit(body.role === "user" ? "question.created" : "response.created", { ...turn, queue_item_id: conv.queue_item_id });
  return json(turn, 201);
}
