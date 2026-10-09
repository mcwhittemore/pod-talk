import { json } from "@/lib/http";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await one("SELECT 1");
    return json({ ok: true, db: true, llm: Boolean(process.env.ANTHROPIC_API_KEY), blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN) });
  } catch (e) {
    return json({ ok: false, db: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
