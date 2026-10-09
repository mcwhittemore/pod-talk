import Link from "next/link";
import { requirePageAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import type { FeedRow } from "@/lib/feeds";
import { addFeedAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function FeedsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePageAuth();
  const { error } = await searchParams;
  const feeds = await query<FeedRow>(
    `SELECT f.*, (SELECT count(*)::int FROM episodes e WHERE e.feed_id = f.id) AS episode_count
     FROM feeds f ORDER BY f.created_at DESC`,
  );
  return (
    <>
      <h1>Feeds</h1>
      {error && <div className="error">Could not add feed: {error}</div>}
      <div className="card">
        <form className="inline" action={addFeedAction}>
          <input type="url" name="url" placeholder="https://example.com/podcast.rss" required />
          <button className="primary" type="submit">Add feed</button>
        </form>
      </div>
      {feeds.length === 0 && <div className="empty">No feeds yet. Paste an RSS URL above.</div>}
      {feeds.map((f) => (
        <div className="card card-row" key={f.id}>
          {f.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="thumb" src={f.image_url} alt="" />
          ) : (
            <div className="thumb-placeholder" />
          )}
          <div className="grow">
            <div className="title"><Link href={`/feeds/${f.id}`}>{f.title ?? f.url}</Link></div>
            <div className="muted small">{f.episode_count ?? 0} episodes</div>
            <div className="muted small ellipsis">{f.url}</div>
          </div>
          <Link className="btn" href={`/feeds/${f.id}`}>Episodes</Link>
        </div>
      ))}
    </>
  );
}
