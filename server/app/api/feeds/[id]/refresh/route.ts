import { requireAuth } from "@/lib/auth";
import { isUuid, json, notFound } from "@/lib/http";
import { refreshFeed } from "@/lib/feeds";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  try {
    const { feed, episodes } = await refreshFeed(id);
    return json({ feed, episodes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "feed not found") return notFound();
    return json({ error: "feed_fetch_failed", detail: msg }, 502);
  }
}
