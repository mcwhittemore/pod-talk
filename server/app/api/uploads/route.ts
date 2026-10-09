import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAuth } from "@/lib/auth";
import { json } from "@/lib/http";
import { addUploadToQueue } from "@/lib/queue";
import { emit } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: "blob_not_configured" }, 503);
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return json({ error: "invalid json" }, 400);

  // The token-generation step comes from the browser and must be authenticated.
  // The completion callback comes from Vercel Blob itself and is verified by handleUpload.
  if (body.type === "blob.generate-client-token") {
    const denied = requireAuth(req);
    if (denied) return denied;
  }

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let title = pathname.split("/").pop() ?? "Upload";
        try {
          const parsed = clientPayload ? (JSON.parse(clientPayload) as { title?: string }) : null;
          if (parsed?.title) title = parsed.title;
        } catch {
          /* ignore */
        }
        return {
          allowedContentTypes: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/flac"],
          maximumSizeInBytes: 500 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ title }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let title = blob.pathname.split("/").pop() ?? "Upload";
        try {
          const parsed = tokenPayload ? (JSON.parse(tokenPayload) as { title?: string }) : null;
          if (parsed?.title) title = parsed.title;
        } catch {
          /* ignore */
        }
        const { item, created } = await addUploadToQueue(blob.url, title);
        if (item && created) await emit("queue.item.added", item);
      },
    });
    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
