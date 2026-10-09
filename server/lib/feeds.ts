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

export async function refreshFeed(feedId: string): Promise<{ feed: FeedRow; episodes: number }> {
  const feed = await one<FeedRow>("SELECT * FROM feeds WHERE id = $1", [feedId]);
  if (!feed) throw new Error("feed not found");
  const parsed = await fetchFeed(feed.url);
  const updated = await one<FeedRow>(
    `UPDATE feeds SET title = COALESCE($2, title), image_url = COALESCE($3, image_url) WHERE id = $1 RETURNING *`,
    [feedId, parsed.title, parsed.image_url],
  );
  for (const ep of parsed.episodes) {
    await query(
      `INSERT INTO episodes (feed_id, guid, title, description, audio_url, image_url, duration_sec, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (feed_id, guid) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, audio_url = EXCLUDED.audio_url,
         image_url = EXCLUDED.image_url, duration_sec = EXCLUDED.duration_sec, published_at = EXCLUDED.published_at`,
      [feedId, ep.guid, ep.title, ep.description, ep.audio_url, ep.image_url, ep.duration_sec, ep.published_at],
    );
  }
  return { feed: updated ?? feed, episodes: parsed.episodes.length };
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
