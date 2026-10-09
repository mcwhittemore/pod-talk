import { requireAuth } from "@/lib/auth";
import { badRequest, int32, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const SYSTEM =
  "You are a listening companion for a podcast. The listener paused playback to ask a question. " +
  "Answer briefly, in 1-3 spoken sentences, using only the transcript excerpt provided. " +
  "If the excerpt does not contain the answer or you are unsure, say so plainly.";

const MAX_QUESTION = 2000;
const MAX_TITLE = 300;
const MAX_CONTEXT = 12000;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "no_llm" }, 503);
  const body = await readJson<{ question?: unknown; context?: unknown; title?: unknown; audio_position_ms?: unknown }>(req);
  const question = str(body?.question).trim();
  if (!body || !question) return badRequest("question is required");
  if (question.length > MAX_QUESTION) return badRequest(`question too long (max ${MAX_QUESTION} chars)`);

  const posMs = int32(body.audio_position_ms);
  const pos = posMs != null ? Math.floor(posMs / 1000) : null;
  const title = str(body.title).trim().slice(0, MAX_TITLE) || "(unknown)";
  const user =
    `Podcast: ${title}\n` +
    (pos != null ? `Playback position: ${Math.floor(pos / 60)}m${pos % 60}s\n` : "") +
    `\nTranscript excerpt:\n"""\n${str(body.context).slice(0, MAX_CONTEXT)}\n"""\n\nQuestion: ${question}`;

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
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
  } catch (e) {
    // Network failure or timeout: tell the client to fall back to the on-device answer.
    const detail = e instanceof Error ? (e.name === "TimeoutError" ? "timeout" : e.message) : String(e);
    return json({ error: "llm_unavailable", detail }, 503);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return json({ error: "llm_error", status: res.status, detail: text.slice(0, 500) }, 502);
  }
  let data: { content?: Array<{ type: string; text?: string }> };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return json({ error: "llm_error", detail: "invalid response" }, 502);
  }
  const answer = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  return json({ answer, engine: "claude" });
}
