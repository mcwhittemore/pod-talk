import { requireAuth } from "@/lib/auth";
import { badRequest, isUuid, json, readJson } from "@/lib/http";
import { addEpisodeToQueue, addUploadToQueue, listQueue } from "@/lib/queue";
import { emit } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  return json({ items: await listQueue() });
}

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = await readJson<{ episode_id?: string; audio_url?: string; title?: string }>(req);
  if (!body) return badRequest("invalid json");

  if (body.episode_id) {
    if (!isUuid(body.episode_id)) return badRequest("episode_id must be a uuid");
    const item = await addEpisodeToQueue(body.episode_id);
    if (!item) return badRequest("episode not found or has no audio");
    await emit("queue.item.added", item);
    return json(item, 201);
  }

  if (body.audio_url) {
    let url: URL;
    try {
      url = new URL(body.audio_url);
    } catch {
      return badRequest("audio_url must be a valid URL");
    }
    if (!/^https?:$/.test(url.protocol)) return badRequest("audio_url must be http(s)");
    const title = (body.title ?? "").trim() || decodeURIComponent(url.pathname.split("/").pop() || "Upload");
    const { item, created } = await addUploadToQueue(url.toString(), title);
    if (!item) return badRequest("could not create item");
    if (created) await emit("queue.item.added", item);
    return json(item, created ? 201 : 200);
  }

  return badRequest("provide episode_id or audio_url");
}
