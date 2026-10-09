import { query } from "./db";

export interface Turn {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  text: string;
  audio_position_ms: number;
  segment_start_ms: number | null;
  segment_end_ms: number | null;
  context_excerpt: string | null;
  engine: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  queue_item_id: string;
  queue_item_title: string;
  status: "active" | "paused" | "ended";
  audio_position_ms: number;
  started_at: string;
  ended_at: string | null;
  turns: Turn[];
}

export async function listConversations(queueItemId?: string | null): Promise<Conversation[]> {
  const convs = await query<Omit<Conversation, "turns">>(
    `SELECT c.id, c.queue_item_id, q.title AS queue_item_title, c.status, c.audio_position_ms, c.started_at, c.ended_at
     FROM conversations c JOIN queue_items q ON q.id = c.queue_item_id
     WHERE ($1::uuid IS NULL OR c.queue_item_id = $1::uuid)
     ORDER BY c.started_at DESC`,
    [queueItemId ?? null],
  );
  if (convs.length === 0) return [];
  const turns = await query<Turn>(
    `SELECT * FROM turns WHERE conversation_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
    [convs.map((c) => c.id)],
  );
  const byConv = new Map<string, Turn[]>();
  for (const t of turns) {
    const arr = byConv.get(t.conversation_id) ?? [];
    arr.push(t);
    byConv.set(t.conversation_id, arr);
  }
  return convs.map((c) => ({ ...c, turns: byConv.get(c.id) ?? [] }));
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const convs = await query<Omit<Conversation, "turns">>(
    `SELECT c.id, c.queue_item_id, q.title AS queue_item_title, c.status, c.audio_position_ms, c.started_at, c.ended_at
     FROM conversations c JOIN queue_items q ON q.id = c.queue_item_id WHERE c.id = $1`,
    [id],
  );
  if (convs.length === 0) return null;
  const turns = await query<Turn>("SELECT * FROM turns WHERE conversation_id = $1 ORDER BY created_at ASC", [id]);
  return { ...convs[0], turns };
}
