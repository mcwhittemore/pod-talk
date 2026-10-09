import { requireAuth } from "@/lib/auth";
import { badRequest, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const SYSTEM =
  "You are a listening companion for a podcast. The listener paused playback to ask a question. " +
  "Answer briefly, in 1-3 spoken sentences, using only the transcript excerpt provided. " +
  "If the excerpt does not contain the answer or you are unsure, say so plainly.";

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "no_llm" }, 503);
  const body = await readJson<{ question?: string; context?: string; title?: string; audio_position_ms?: number }>(req);
  if (!body || typeof body.question !== "string" || !body.question.trim()) return badRequest("question is required");

  const pos = typeof body.audio_position_ms === "number" ? Math.floor(body.audio_position_ms / 1000) : null;
  const user =
    `Podcast: ${body.title ?? "(unknown)"}\n` +
    (pos != null ? `Playback position: ${Math.floor(pos / 60)}m${pos % 60}s\n` : "") +
    `\nTranscript excerpt:\n"""\n${(body.context ?? "").slice(0, 12000)}\n"""\n\nQuestion: ${body.question.trim()}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text();
    return json({ error: "llm_error", status: res.status, detail: text.slice(0, 500) }, 502);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const answer = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  return json({ answer, engine: "claude" });
}
