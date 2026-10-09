"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";

export function UploadForm({ enabled }: { enabled: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMessage(null);
    setProgress(0);
    const finalTitle = title.trim() || file.name;
    try {
      const blob = await upload(`uploads/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/uploads",
        clientPayload: JSON.stringify({ title: finalTitle }),
        onUploadProgress: (p) => setProgress(p.percentage),
      });
      // onUploadCompleted does not fire on localhost, so enqueue explicitly (idempotent on audio_url).
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audio_url: blob.url, title: finalTitle }),
      });
      if (!res.ok) throw new Error(`queue insert failed: HTTP ${res.status}`);
      setMessage({ kind: "success", text: `Uploaded and queued "${finalTitle}".` });
      setFile(null);
      setTitle("");
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {message && <div className={message.kind}>{message.text}</div>}
      <div className="field">
        <label htmlFor="file">Audio file</label>
        <input id="file" type="file" accept="audio/*" disabled={!enabled || busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="field">
        <label htmlFor="title">Title (optional)</label>
        <input id="title" type="text" value={title} disabled={!enabled || busy} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name ?? "Episode title"} />
      </div>
      <button className="primary" type="submit" disabled={!enabled || !file || busy}>{busy ? "Uploading..." : "Upload"}</button>
      {progress != null && <div className="progress"><div style={{ width: `${progress}%` }} /></div>}
    </form>
  );
}
