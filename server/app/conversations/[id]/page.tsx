import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAuth } from "@/lib/auth";
import { getConversation } from "@/lib/conversations";
import { one } from "@/lib/db";
import { isUuid } from "@/lib/http";
import { mmss, fmtDate, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Segment { start_ms: number; end_ms: number; text: string }

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAuth();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const conv = await getConversation(id);
  if (!conv) notFound();
  const transcript = await one<{ engine: string | null; duration_ms: number | null; segments: Segment[] }>(
    "SELECT engine, duration_ms, segments FROM transcripts WHERE queue_item_id = $1",
    [conv.queue_item_id],
  );
  const segments = transcript?.segments ?? [];

  // Which turns reference which segments (by overlap of segment range, or by audio position).
  const refs = new Map<number, number[]>();
  conv.turns.forEach((t, ti) => {
    const start = t.segment_start_ms ?? t.audio_position_ms;
    const end = t.segment_end_ms ?? t.audio_position_ms;
    segments.forEach((s, si) => {
      const hit = start === end ? s.start_ms <= start && start < s.end_ms : s.end_ms > start && s.start_ms < end;
      if (hit) refs.set(si, [...(refs.get(si) ?? []), ti + 1]);
    });
  });

  return (
    <>
      <p className="small"><Link href="/conversations">← Conversations</Link></p>
      <div className="card">
        <div className="page-head" style={{ marginBottom: 4 }}>
          <h1>{conv.queue_item_title}</h1>
          <span className={`badge badge-${conv.status}`}>{conv.status}</span>
        </div>
        <div className="muted small">
          Started {fmtDate(conv.started_at)} at audio position {mmss(conv.audio_position_ms)}
          {conv.ended_at && <> · ended {fmtDate(conv.ended_at)}</>}
          {" · "}<Link href={`/conversations?queue_item_id=${conv.queue_item_id}`}>other conversations on this item</Link>
        </div>
      </div>

      <h2>Turns</h2>
      <div className="card">
        {conv.turns.length === 0 && <div className="muted">No turns yet.</div>}
        {conv.turns.map((t, i) => (
          <div className="turn" key={t.id}>
            <div className={`role role-${t.role}`}>#{i + 1} {t.role}</div>
            <div>
              <div className="turn-text">{t.text}</div>
              <div className="turn-meta">
                <span>audio {mmss(t.audio_position_ms)}</span>
                {t.segment_start_ms != null && t.segment_end_ms != null && (
                  <span>segments {mmss(t.segment_start_ms)}–{mmss(t.segment_end_ms)}</span>
                )}
                {t.engine && <span>engine {t.engine}</span>}
                <span>{fmtTime(t.created_at)}</span>
              </div>
              {t.context_excerpt && <div className="excerpt">{t.context_excerpt}</div>}
            </div>
          </div>
        ))}
      </div>

      <h2>Transcript {transcript && <span className="muted small">({transcript.engine ?? "unknown engine"} · {segments.length} segments · {mmss(transcript.duration_ms)})</span>}</h2>
      {!transcript && <div className="empty">No transcript synced for this item yet.</div>}
      {transcript && (
        <div className="card segments">
          {segments.map((s, si) => {
            const r = refs.get(si);
            return (
              <div className={`seg${r ? " hl" : ""}`} key={si}>
                <div className="t">{mmss(s.start_ms)} – {mmss(s.end_ms)}</div>
                <div>
                  {s.text}
                  {r && <div className="refs">referenced by turn{r.length === 1 ? "" : "s"} {r.map((n) => `#${n}`).join(", ")}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
