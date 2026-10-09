import { requireAuth } from "@/lib/auth";
import { isUuid, json, notFound } from "@/lib/http";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const rows = await query("DELETE FROM webhooks WHERE id = $1 RETURNING id", [id]);
  return rows.length ? json({ ok: true }) : notFound();
}
