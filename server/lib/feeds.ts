import { query, one } from "./db";
import { fetchFeed } from "./rss";

export interface FeedRow {
  id: string;
  url: string;
  title: string | null;
  image_url: string | null;
  created_at: string;
  episode_count?: number;
}

const BATCH = 200;

export async function refreshFeed(feedId: string): Promise<{ feed: FeedRow; episodes: number }> {
  const feed = await one<FeedRow>("SELECT * FROM feeds WHERE id = $1", [feedId]);
  if (!feed) throw new Error("feed not found");
  const parsed = await fetchFeed(feed.url);
  const updated = await one<FeedRow>(
    `UPDATE feeds SET title = COALESCE($2, title), image_url = COALESCE($3, image_url) WHERE id = $1 RETURNING *`,
    [feedId, parsed.title, parsed.image_url],
  );
  // Dedupe by guid within the feed: a single upsert statement cannot touch the same row twice.
  const episodes = [...new Map(parsed.episodes.map((ep) => [ep.guid, ep])).values()];
  for (let i = 0; i < episodes.length; i += BATCH) {
    const chunk = episodes.slice(i, i + BATCH);
    await query(
      `INSERT INTO episodes (feed_id, guid, title, description, audio_url, image_url, duration_sec, published_at)
       SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::timestamptz[])
       ON CONFLICT (feed_id, guid) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, audio_url = EXCLUDED.audio_url,
         image_url = EXCLUDED.image_url, duration_sec = EXCLUDED.duration_sec, published_at = EXCLUDED.published_at`,
      [
        feedId,
        chunk.map((e) => e.guid),
        chunk.map((e) => e.title),
        chunk.map((e) => e.description),
        chunk.map((e) => e.audio_url),
        chunk.map((e) => e.image_url),
        chunk.map((e) => e.duration_sec),
        chunk.map((e) => e.published_at),
      ],
    );
  }
  return { feed: updated ?? feed, episodes: episodes.length };
}

/** Insert the feed row (if missing) then fetch+upsert its episodes. */
export async function addFeed(url: string): Promise<{ feed: FeedRow; episodes: number }> {
  const feed = await one<FeedRow>(
    `INSERT INTO feeds (url) VALUES ($1) ON CONFLICT (url) DO UPDATE SET url = EXCLUDED.url RETURNING *`,
    [url],
  );
  if (!feed) throw new Error("insert failed");
  return refreshFeed(feed.id);
}
