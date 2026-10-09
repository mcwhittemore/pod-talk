import { requireAuth } from "@/lib/auth";
import { isUuid, json, notFound } from "@/lib/http";
import { one } from "@/lib/db";
import { deliver } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const hook = await one<{ id: string; url: string; secret: string; events: string[]; active: boolean }>(
    "SELECT id, url, secret, events, active FROM webhooks WHERE id = $1",
    [id],
  );
  if (!hook) return notFound();
  await deliver(hook, "webhook.test", { message: "Hello from Pod Talk", webhook_id: hook.id });
  const delivery = await one(
    "SELECT id, event, status_code, ok, error, created_at FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT 1",
    [id],
  );
  return json({ ok: delivery ? (delivery as { ok: boolean }).ok : false, delivery });
}
