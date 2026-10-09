# Pod Talk — plan and API contract

Written 2026-10-08 at the start of the build. One repo, two deliverables:

- `server/` — Next.js app on Vercel, Postgres on Neon. RSS feeds, uploads, listen queue, transcripts, conversations, webhooks.
- `android/` — Kotlin/Compose app for Pixel 8 (Android 15). Downloads queue audio, transcribes on-device, plays it, lets you interrupt by voice.
- `core/` — Rust crate (`podtalk-core`) compiled with cargo-ndk into the app. Audio decode/resample, VAD/trim, whisper.cpp transcription, filler-word removal, BM25 extractive answers.

## Desert Ant on Android

Desert Ant Labs ships Kotlin SDKs for Clear, Ear, Emo, Gist, Moderator, Redact, Shapes, Tongue. **Voz and Uhm have no Android build** ("There is no Android or Linux build" in the Voz docs; Uhm needs Apple silicon).

Resolution:
- **Clear** → used as-is via `ai.desertant:clear:3.6.0` (Maven Central) to clean up the user's spoken question.
- **Voz** → replaced by **whisper.cpp through `whisper-rs`** inside the Rust core (word/segment timestamps, fully offline, arm64 NEON). Model: `ggml-base.en` (or `tiny.en`), downloaded on first launch from Hugging Face.
- **Uhm** → replaced by Rust filler-span removal on the whisper transcript (`uh`, `um`, `hmm`, `erm`, `mm`, `ah`, repeated stutters), using whisper's token timestamps.
- **Reply generation** → server `/api/answer` calls Claude (Haiku 4.5) when `ANTHROPIC_API_KEY` is set on Vercel; otherwise the app falls back to an on-device Rust BM25 extractive answer built from the transcript around the current playback position.

## Auth

Single-user. One shared secret `POD_TALK_TOKEN` (env on Vercel). Web UI: `/login` sets an httpOnly cookie. API: `Authorization: Bearer <token>`.

## Database (Postgres)

```
feeds(id uuid pk, url text unique, title text, image_url text, created_at timestamptz)
episodes(id uuid pk, feed_id uuid fk, guid text, title text, description text, audio_url text, image_url text, duration_sec int, published_at timestamptz, unique(feed_id, guid))
queue_items(id uuid pk, episode_id uuid null fk, title text, audio_url text, source text 'feed'|'upload', position int, status text 'queued'|'downloaded'|'transcribed'|'listening'|'done', duration_ms int null, created_at, updated_at)
transcripts(queue_item_id uuid pk fk, engine text, duration_ms int, segments jsonb, synced_at timestamptz)
conversations(id uuid pk, queue_item_id uuid fk, status 'active'|'paused'|'ended', audio_position_ms int, started_at, ended_at)
turns(id uuid pk, conversation_id uuid fk, role 'user'|'assistant', text text, audio_position_ms int, segment_start_ms int null, segment_end_ms int null, context_excerpt text null, engine text null, created_at)
webhooks(id uuid pk, url text, secret text, events text[] (empty = all), active bool, created_at)
webhook_deliveries(id uuid pk, webhook_id uuid fk, event text, payload jsonb, status_code int null, ok bool, error text null, created_at)
```

## Webhook events

`queue.item.added`, `queue.item.updated`, `transcript.synced`, `conversation.started`, `conversation.paused`, `conversation.resumed`, `conversation.ended`, `question.created`, `response.created`.

POST JSON `{ "id", "event", "created_at", "data": {...} }` with header `X-PodTalk-Signature: sha256=<hex hmac of body with webhook.secret>` and `X-PodTalk-Event`. Delivery result logged to `webhook_deliveries`.

## HTTP API (all under `/api`, bearer auth)

- `GET /queue` → `{ items: [{ id, title, audio_url, source, status, position, duration_ms, has_transcript, episode: { id, title, feed_title, image_url, published_at } | null }] }`
- `POST /queue` `{ episode_id }` or `{ audio_url, title }` → item. Fires `queue.item.added`.
- `PATCH /queue/:id` `{ status?, duration_ms? }` → item. Fires `queue.item.updated`.
- `DELETE /queue/:id`
- `GET /queue/:id/transcript` → `{ engine, duration_ms, segments: [{ start_ms, end_ms, text }] }` or 404
- `PUT /queue/:id/transcript` `{ engine, duration_ms, segments }` → 200. Fires `transcript.synced` (data: queue_item_id, segment_count, duration_ms).
- `GET /conversations?queue_item_id=` → `{ conversations: [{ id, status, audio_position_ms, started_at, ended_at, turns: [...] }] }`
- `POST /conversations` `{ queue_item_id, audio_position_ms }` → `{ id }`. Fires `conversation.started`.
- `POST /conversations/:id/events` `{ type: 'paused'|'resumed'|'ended', audio_position_ms }` → 200. Fires `conversation.paused|resumed|ended`.
- `POST /conversations/:id/turns` `{ role, text, audio_position_ms, segment_start_ms?, segment_end_ms?, context_excerpt?, engine?, client_ts? }` → turn. Fires `question.created` for role user, `response.created` for role assistant.
- `POST /answer` `{ question, context, title, audio_position_ms }` → `{ answer, engine: 'claude' }` or `503 { error: 'no_llm' }` when no API key.
- `GET /feeds`, `POST /feeds { url }` (fetch + parse + upsert episodes), `POST /feeds/:id/refresh`, `DELETE /feeds/:id`, `GET /feeds/:id/episodes`
- `POST /uploads` — Vercel Blob client-upload handshake (`handleUpload`); `onUploadCompleted` creates a queue item with `source='upload'`.
- `GET/POST /webhooks`, `DELETE /webhooks/:id`, `POST /webhooks/:id/test`
- `GET /health`

## Web pages

`/login`, `/` (queue + status), `/feeds` (add feed, list), `/feeds/[id]` (episodes, "Add to queue"), `/uploads` (upload audio), `/conversations` and `/conversations/[id]` (transcript + Q/A with timestamps and audio positions), `/webhooks` (manage + delivery log).
