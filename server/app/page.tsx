import Link from "next/link";
import { requirePageAuth } from "@/lib/auth";
import { listQueue } from "@/lib/queue";
import { query } from "@/lib/db";
import { mmss, fmtDate } from "@/lib/format";
import { removeQueueItem } from "./actions";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  await requirePageAuth();
  const items = await listQueue();
  const counts = await query<{ queue_item_id: string; segments: number; conversations: number }>(
    `SELECT q.id AS queue_item_id,
       COALESCE(jsonb_array_length(t.segments), 0)::int AS segments,
       (SELECT count(*)::int FROM conversations c WHERE c.queue_item_id = q.id) AS conversations
     FROM queue_items q LEFT JOIN transcripts t ON t.queue_item_id = q.id`,
  );
  const meta = new Map(counts.map((c) => [c.queue_item_id, c]));

  return (
    <>
      <div className="page-head">
        <h1>Listen queue</h1>
        <span className="muted small">{items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>
      {items.length === 0 && (
        <div className="empty">
          Nothing queued yet. Add an episode from a <Link href="/feeds">feed</Link> or <Link href="/uploads">upload audio</Link>.
        </div>
      )}
      {items.map((it) => {
        const m = meta.get(it.id);
        return (
          <div className="card card-row" key={it.id}>
            {it.episode?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="thumb" src={it.episode.image_url} alt="" />
            ) : (
              <div className="thumb-placeholder" />
            )}
            <div className="grow">
              <div className="title">
                {it.title} <span className={`badge badge-${it.status}`}>{it.status}</span>{" "}
                <span className={`badge badge-${it.source}`}>{it.source}</span>
              </div>
              <div className="muted small">
                {it.episode?.feed_title && <>{it.episode.feed_title} · </>}
                {it.duration_ms != null && <>{mmss(it.duration_ms)} · </>}
                {it.has_transcript ? `${m?.segments ?? 0} transcript segments` : "no transcript"} ·{" "}
                <Link href={`/conversations?queue_item_id=${it.id}`}>{m?.conversations ?? 0} conversation{m?.conversations === 1 ? "" : "s"}</Link>
                {" · "}added {fmtDate(it.created_at)}
              </div>
              <div className="muted small ellipsis"><a href={it.audio_url} target="_blank" rel="noreferrer">{it.audio_url}</a></div>
            </div>
            <form action={removeQueueItem}>
              <input type="hidden" name="id" value={it.id} />
              <button className="danger" type="submit">Remove</button>
            </form>
          </div>
        );
      })}
    </>
  );
}
