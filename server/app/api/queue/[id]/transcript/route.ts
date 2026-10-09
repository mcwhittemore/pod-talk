import { requireAuth } from "@/lib/auth";
import { badRequest, isUuid, json, notFound, readJson } from "@/lib/http";
import { one, query } from "@/lib/db";
import { emit } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export interface Segment {
  start_ms: number;
  end_ms: number;
  text: string;
}

export async function GET(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const t = await one<{ engine: string | null; duration_ms: number | null; segments: Segment[] }>(
    "SELECT engine, duration_ms, segments FROM transcripts WHERE queue_item_id = $1",
    [id],
  );
  return t ? json(t) : notFound();
}

export async function PUT(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const body = await readJson<{ engine?: string; duration_ms?: number; segments?: unknown }>(req);
  if (!body) return badRequest("invalid json");
  if (!Array.isArray(body.segments)) return badRequest("segments must be an array");
  const segments: Segment[] = [];
  for (const s of body.segments as Array<Record<string, unknown>>) {
    if (!s || typeof s.start_ms !== "number" || typeof s.end_ms !== "number" || typeof s.text !== "string") {
      return badRequest("each segment needs start_ms, end_ms, text");
    }
    segments.push({ start_ms: s.start_ms, end_ms: s.end_ms, text: s.text });
  }
  const exists = await one("SELECT id FROM queue_items WHERE id = $1", [id]);
  if (!exists) return notFound();
  const duration = typeof body.duration_ms === "number" ? body.duration_ms : null;
  await query(
    `INSERT INTO transcripts (queue_item_id, engine, duration_ms, segments, synced_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (queue_item_id) DO UPDATE SET engine = EXCLUDED.engine, duration_ms = EXCLUDED.duration_ms,
       segments = EXCLUDED.segments, synced_at = now()`,
    [id, body.engine ?? null, duration, JSON.stringify(segments)],
  );
  await query(
    `UPDATE queue_items SET duration_ms = COALESCE($2, duration_ms),
       status = CASE WHEN status IN ('queued','downloaded') THEN 'transcribed' ELSE status END,
       updated_at = now() WHERE id = $1`,
    [id, duration],
  );
  await emit("transcript.synced", { queue_item_id: id, segment_count: segments.length, duration_ms: duration });
  return json({ ok: true, segment_count: segments.length });
}
