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
  const feed = await one("SELECT * FROM feeds WHERE id = $1", [id]);
  return feed ? json(feed) : notFound();
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const rows = await query("DELETE FROM feeds WHERE id = $1 RETURNING id", [id]);
  return rows.length ? json({ ok: true }) : notFound();
}
