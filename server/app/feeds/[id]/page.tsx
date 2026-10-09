import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAuth } from "@/lib/auth";
import { one, query } from "@/lib/db";
import type { FeedRow } from "@/lib/feeds";
import { isUuid } from "@/lib/http";
import { mmss, fmtDate } from "@/lib/format";
import { deleteFeedAction, enqueueEpisodeAction, refreshFeedAction } from "@/app/actions";

export const dynamic = "force-dynamic";

interface EpisodeRow {
  id: string;
  title: string | null;
  description: string | null;
  audio_url: string | null;
  image_url: string | null;
  duration_sec: number | null;
  published_at: string | null;
  queued: boolean;
}

function stripHtml(s: string | null): string {
  if (!s) return "";
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export default async function FeedPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAuth();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const feed = await one<FeedRow>("SELECT * FROM feeds WHERE id = $1", [id]);
  if (!feed) notFound();
  const episodes = await query<EpisodeRow>(
    `SELECT e.*, EXISTS (SELECT 1 FROM queue_items q WHERE q.episode_id = e.id) AS queued
     FROM episodes e WHERE e.feed_id = $1 ORDER BY e.published_at DESC NULLS LAST, e.title ASC LIMIT 200`,
    [id],
  );
  return (
    <>
      <p className="small"><Link href="/feeds">← Feeds</Link></p>
      <div className="card card-row">
        {feed.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={feed.image_url} alt="" />
        ) : (
          <div className="thumb-placeholder" />
        )}
        <div className="grow">
          <h1 style={{ marginBottom: 4 }}>{feed.title ?? feed.url}</h1>
          <div className="muted small ellipsis">{feed.url}</div>
        </div>
        <div className="actions">
          <form action={refreshFeedAction}><input type="hidden" name="id" value={feed.id} /><button type="submit">Refresh</button></form>
          <form action={deleteFeedAction}><input type="hidden" name="id" value={feed.id} /><button className="danger" type="submit">Delete</button></form>
        </div>
      </div>
      <h2>Episodes <span className="muted small">({episodes.length})</span></h2>
      {episodes.length === 0 && <div className="empty">No episodes parsed from this feed.</div>}
      {episodes.map((e) => {
        const desc = stripHtml(e.description);
        return (
          <div className="card card-row" key={e.id}>
            <div className="grow">
              <div className="title">{e.title ?? "(untitled)"} {e.queued && <span className="badge badge-queued">queued</span>}</div>
              <div className="muted small">
                {e.published_at && <>{fmtDate(e.published_at)} · </>}
                {e.duration_sec != null && <>{mmss(e.duration_sec * 1000)}</>}
              </div>
              {desc && <div className="small muted" style={{ marginTop: 4 }}>{desc.length > 220 ? desc.slice(0, 220) + "…" : desc}</div>}
            </div>
            <form action={enqueueEpisodeAction}>
              <input type="hidden" name="episode_id" value={e.id} />
              <input type="hidden" name="feed_id" value={feed.id} />
              <button className="primary" type="submit" disabled={!e.audio_url}>Add to queue</button>
            </form>
          </div>
        );
      })}
    </>
  );
}
