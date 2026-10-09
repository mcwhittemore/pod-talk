import Link from "next/link";
import { requirePageAuth } from "@/lib/auth";
import { listConversations, type Conversation } from "@/lib/conversations";
import { isUuid } from "@/lib/http";
import { mmss, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ queue_item_id?: string }> }) {
  await requirePageAuth();
  const { queue_item_id } = await searchParams;
  const filter = isUuid(queue_item_id) ? queue_item_id : null;
  const convs = await listConversations(filter);
  const groups = new Map<string, { title: string; items: Conversation[] }>();
  for (const c of convs) {
    const g = groups.get(c.queue_item_id) ?? { title: c.queue_item_title, items: [] };
    g.items.push(c);
    groups.set(c.queue_item_id, g);
  }
  return (
    <>
      <div className="page-head">
        <h1>Conversations</h1>
        {filter && <Link className="small" href="/conversations">Show all</Link>}
      </div>
      {convs.length === 0 && <div className="empty">No conversations yet. They appear here once the app syncs a Q&amp;A.</div>}
      {[...groups.entries()].map(([qid, g]) => (
        <div className="conv-group" key={qid}>
          <h2>{g.title} <Link className="small" href={`/conversations?queue_item_id=${qid}`} style={{ fontWeight: 400 }}>filter</Link></h2>
          <div className="conv-list">
            {g.items.map((c) => {
              const questions = c.turns.filter((t) => t.role === "user").length;
              const first = c.turns.find((t) => t.role === "user");
              return (
                <div className="conv-item" key={c.id}>
                  <span className={`badge badge-${c.status}`}>{c.status}</span>
                  <div className="grow">
                    <div><Link href={`/conversations/${c.id}`}>{first ? first.text : "(no turns yet)"}</Link></div>
                    <div className="muted small">
                      at {mmss(c.audio_position_ms)} · {c.turns.length} turn{c.turns.length === 1 ? "" : "s"} ({questions} question{questions === 1 ? "" : "s"}) · started {fmtDate(c.started_at)}
                    </div>
                  </div>
                  <Link className="btn" href={`/conversations/${c.id}`}>Open</Link>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
