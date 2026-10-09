import { requireAuth } from "@/lib/auth";
import { badRequest, json, readJson } from "@/lib/http";
import { query } from "@/lib/db";
import { addFeed, type FeedRow } from "@/lib/feeds";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const feeds = await query<FeedRow>(
    `SELECT f.*, (SELECT count(*)::int FROM episodes e WHERE e.feed_id = f.id) AS episode_count
     FROM feeds f ORDER BY f.created_at DESC`,
  );
  return json({ feeds });
}

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = await readJson<{ url?: string }>(req);
  if (!body || typeof body.url !== "string") return badRequest("url is required");
  let url: URL;
  try {
    url = new URL(body.url.trim());
  } catch {
    return badRequest("url must be a valid URL");
  }
  if (!/^https?:$/.test(url.protocol)) return badRequest("url must be http(s)");
  try {
    const { feed, episodes } = await addFeed(url.toString());
    return json({ feed, episodes }, 201);
  } catch (e) {
    return json({ error: "feed_fetch_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
}
