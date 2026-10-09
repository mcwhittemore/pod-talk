import { query, one } from "./db";
import { int32 } from "./http";

export interface QueueItem {
  id: string;
  title: string;
  audio_url: string;
  source: "feed" | "upload";
  status: string;
  position: number;
  duration_ms: number | null;
  has_transcript: boolean;
  created_at: string;
  updated_at: string;
  episode: {
    id: string;
    title: string | null;
    feed_title: string | null;
    image_url: string | null;
    published_at: string | null;
  } | null;
}

const SELECT = `
  SELECT q.id, q.title, q.audio_url, q.source, q.status, q.position, q.duration_ms,
         q.created_at, q.updated_at,
         (t.queue_item_id IS NOT NULL) AS has_transcript,
         CASE WHEN e.id IS NULL THEN NULL ELSE json_build_object(
           'id', e.id, 'title', e.title, 'feed_title', f.title,
           'image_url', e.image_url, 'published_at', e.published_at) END AS episode
  FROM queue_items q
  LEFT JOIN transcripts t ON t.queue_item_id = q.id
  LEFT JOIN episodes e ON e.id = q.episode_id
  LEFT JOIN feeds f ON f.id = e.feed_id`;

// Computed inside the INSERT so concurrent adds cannot read the same MAX(position).
const NEXT_POSITION = "(SELECT COALESCE(MAX(position), 0) + 1 FROM queue_items)";

export async function listQueue(): Promise<QueueItem[]> {
  return query<QueueItem>(`${SELECT} ORDER BY q.position ASC, q.created_at ASC`);
}

export async function getQueueItem(id: string): Promise<QueueItem | null> {
  return one<QueueItem>(`${SELECT} WHERE q.id = $1`, [id]);
}

export async function addEpisodeToQueue(episodeId: string): Promise<QueueItem | null> {
  const ep = await one<{ id: string; title: string | null; audio_url: string | null; duration_sec: number | null }>(
    "SELECT id, title, audio_url, duration_sec FROM episodes WHERE id = $1",
    [episodeId],
  );
  if (!ep || !ep.audio_url) return null;
  const durationMs = ep.duration_sec && ep.duration_sec > 0 ? int32(ep.duration_sec * 1000) ?? null : null;
  const row = await one<{ id: string }>(
    `INSERT INTO queue_items (episode_id, title, audio_url, source, position, duration_ms)
     VALUES ($1, $2, $3, 'feed', ${NEXT_POSITION}, $4) RETURNING id`,
    [ep.id, ep.title ?? "(untitled)", ep.audio_url, durationMs],
  );
  return row ? getQueueItem(row.id) : null;
}

/**
 * Idempotent on audio_url for uploads, enforced by the partial unique index
 * queue_items_upload_url_uidx, so the Blob onUploadCompleted callback and the browser's explicit
 * POST /api/queue cannot both insert. Returns {item, created}.
 */
export async function addUploadToQueue(audioUrl: string, title: string): Promise<{ item: QueueItem | null; created: boolean }> {
  const row = await one<{ id: string }>(
    `INSERT INTO queue_items (title, audio_url, source, position)
     VALUES ($1, $2, 'upload', ${NEXT_POSITION})
     ON CONFLICT (audio_url) WHERE source = 'upload' DO NOTHING
     RETURNING id`,
    [title, audioUrl],
  );
  if (row) return { item: await getQueueItem(row.id), created: true };
  const existing = await one<{ id: string }>(
    "SELECT id FROM queue_items WHERE audio_url = $1 AND source = 'upload' LIMIT 1",
    [audioUrl],
  );
  return { item: existing ? await getQueueItem(existing.id) : null, created: false };
}
