import { requireAuth } from "@/lib/auth";
import { badRequest, int32, isUuid, json, notFound, readJson } from "@/lib/http";
import { one, query } from "@/lib/db";
import { emit } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Vercel rejects request bodies over 4.5 MB before the handler runs; segment-level transcripts of
// multi-hour episodes are well under that. These caps keep a buggy client from writing junk.
const MAX_SEGMENTS = 50_000;
const MAX_SEGMENT_TEXT = 10_000;

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
  if (body.segments.length > MAX_SEGMENTS) return badRequest(`too many segments (max ${MAX_SEGMENTS})`);
  if (body.engine !== undefined && body.engine !== null && typeof body.engine !== "string") return badRequest("engine must be a string");
  const duration = int32(body.duration_ms);
  if (duration === undefined) return badRequest("duration_ms must be a non-negative integer");

  const segments: Segment[] = [];
  for (const s of body.segments as Array<Record<string, unknown>>) {
    const start = int32(s?.start_ms);
    const end = int32(s?.end_ms);
    if (!s || start == null || end == null || typeof s.text !== "string") {
      return badRequest("each segment needs integer start_ms, end_ms (0..2^31-1) and text");
    }
    if (end < start) return badRequest("segment end_ms must be >= start_ms");
    if (s.text.length > MAX_SEGMENT_TEXT) return badRequest(`segment text too long (max ${MAX_SEGMENT_TEXT} chars)`);
    segments.push({ start_ms: start, end_ms: end, text: s.text });
  }

  const exists = await one("SELECT id FROM queue_items WHERE id = $1", [id]);
  if (!exists) return notFound();
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
  emit("transcript.synced", { queue_item_id: id, segment_count: segments.length, duration_ms: duration });
  return json({ ok: true, segment_count: segments.length });
}
