import { requirePageAuth } from "@/lib/auth";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";

export default async function UploadsPage() {
  await requirePageAuth();
  const configured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  return (
    <>
      <h1>Upload audio</h1>
      {!configured && (
        <div className="notice">
          Uploads are disabled: <code>BLOB_READ_WRITE_TOKEN</code> is not set. Connect a Vercel Blob store to this project to enable them.
        </div>
      )}
      <div className="card">
        <p className="muted small">Upload an audio file (mp3, m4a, wav, ogg, flac). It is stored in Vercel Blob and added to the listen queue.</p>
        <UploadForm enabled={configured} />
      </div>
    </>
  );
}
