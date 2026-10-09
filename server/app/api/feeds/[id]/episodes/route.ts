import { requireAuth } from "@/lib/auth";
import { isUuid, json, notFound } from "@/lib/http";
import { one, query } from "@/lib/db";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const feed = await one("SELECT id FROM feeds WHERE id = $1", [id]);
  if (!feed) return notFound();
  const episodes = await query(
    "SELECT * FROM episodes WHERE feed_id = $1 ORDER BY published_at DESC NULLS LAST, title ASC",
    [id],
  );
  return json({ episodes });
}
