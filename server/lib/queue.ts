import { query, one } from "./db";

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

export async function listQueue(): Promise<QueueItem[]> {
  return query<QueueItem>(`${SELECT} ORDER BY q.position ASC, q.created_at ASC`);
}

export async function getQueueItem(id: string): Promise<QueueItem | null> {
  return one<QueueItem>(`${SELECT} WHERE q.id = $1`, [id]);
}

async function nextPosition(): Promise<number> {
  const row = await one<{ next: number }>("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM queue_items");
  return row?.next ?? 1;
}

export async function addEpisodeToQueue(episodeId: string): Promise<QueueItem | null> {
  const ep = await one<{ id: string; title: string | null; audio_url: string | null; duration_sec: number | null }>(
    "SELECT id, title, audio_url, duration_sec FROM episodes WHERE id = $1",
    [episodeId],
  );
  if (!ep || !ep.audio_url) return null;
  const row = await one<{ id: string }>(
    `INSERT INTO queue_items (episode_id, title, audio_url, source, position, duration_ms)
     VALUES ($1, $2, $3, 'feed', $4, $5) RETURNING id`,
    [ep.id, ep.title ?? "(untitled)", ep.audio_url, await nextPosition(), ep.duration_sec ? ep.duration_sec * 1000 : null],
  );
  return row ? getQueueItem(row.id) : null;
}

/** Idempotent on audio_url for uploads. Returns {item, created}. */
export async function addUploadToQueue(audioUrl: string, title: string): Promise<{ item: QueueItem | null; created: boolean }> {
  const existing = await one<{ id: string }>(
    "SELECT id FROM queue_items WHERE audio_url = $1 AND source = 'upload' LIMIT 1",
    [audioUrl],
  );
  if (existing) return { item: await getQueueItem(existing.id), created: false };
  const row = await one<{ id: string }>(
    `INSERT INTO queue_items (title, audio_url, source, position) VALUES ($1, $2, 'upload', $3) RETURNING id`,
    [title, audioUrl, await nextPosition()],
  );
  return { item: row ? await getQueueItem(row.id) : null, created: true };
}
