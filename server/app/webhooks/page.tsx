import { requirePageAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { fmtDate } from "@/lib/format";
import { addWebhookAction, deleteWebhookAction, testWebhookAction } from "@/app/actions";

export const dynamic = "force-dynamic";

interface HookRow { id: string; url: string; events: string[]; active: boolean; created_at: string; deliveries: number }
interface DeliveryRow { id: string; webhook_id: string; url: string; event: string; status_code: number | null; ok: boolean; error: string | null; created_at: string }

export default async function WebhooksPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePageAuth();
  const { error } = await searchParams;
  const hooks = await query<HookRow>(
    `SELECT w.id, w.url, w.events, w.active, w.created_at,
       (SELECT count(*)::int FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS deliveries
     FROM webhooks w ORDER BY w.created_at DESC`,
  );
  const deliveries = await query<DeliveryRow>(
    `SELECT d.id, d.webhook_id, w.url, d.event, d.status_code, d.ok, d.error, d.created_at
     FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
     ORDER BY d.created_at DESC LIMIT 50`,
  );
  return (
    <>
      <h1>Webhooks</h1>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <h3>Add webhook</h3>
        <form action={addWebhookAction}>
          <div className="field">
            <label htmlFor="url">URL</label>
            <input id="url" type="url" name="url" placeholder="https://example.com/hooks/podtalk" required />
          </div>
          <div className="field">
            <label htmlFor="secret">Secret (used for the HMAC-SHA256 signature)</label>
            <input id="secret" type="text" name="secret" placeholder="optional" />
          </div>
          <div className="field">
            <label>Events <span className="muted">(none checked = all events)</span></label>
            <div className="checks">
              {WEBHOOK_EVENTS.map((ev) => (
                <label key={ev}><input type="checkbox" name="events" value={ev} /> {ev}</label>
              ))}
            </div>
          </div>
          <button className="primary" type="submit">Add webhook</button>
        </form>
      </div>

      <h2>Registered</h2>
      {hooks.length === 0 && <div className="empty">No webhooks registered.</div>}
      {hooks.map((h) => (
        <div className="card card-row" key={h.id}>
          <div className="grow">
            <div className="title ellipsis">{h.url}</div>
            <div className="muted small">
              {h.events.length === 0 ? "all events" : h.events.join(", ")} · {h.deliveries} deliveries · added {fmtDate(h.created_at)}
              {!h.active && <> · <span className="badge badge-fail">inactive</span></>}
            </div>
          </div>
          <div className="actions">
            <form action={testWebhookAction}><input type="hidden" name="id" value={h.id} /><button type="submit">Send test</button></form>
            <form action={deleteWebhookAction}><input type="hidden" name="id" value={h.id} /><button className="danger" type="submit">Delete</button></form>
          </div>
        </div>
      ))}

      <h2>Recent deliveries <span className="muted small">(last 50)</span></h2>
      {deliveries.length === 0 ? (
        <div className="empty">No deliveries yet.</div>
      ) : (
        <table>
          <thead>
            <tr><th>When</th><th>Event</th><th>URL</th><th>Result</th></tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id}>
                <td>{fmtDate(d.created_at)}</td>
                <td><code>{d.event}</code></td>
                <td className="ellipsis" style={{ maxWidth: 320 }}>{d.url}</td>
                <td>
                  <span className={`badge ${d.ok ? "badge-ok" : "badge-fail"}`}>{d.ok ? "ok" : "failed"}</span>{" "}
                  <span className="muted">{d.status_code ?? ""} {d.error ?? ""}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
