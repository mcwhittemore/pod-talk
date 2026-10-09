-- Pod Talk schema. Idempotent: safe to re-run.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL UNIQUE,
  title text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id uuid NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid text NOT NULL,
  title text,
  description text,
  audio_url text,
  image_url text,
  duration_sec int,
  published_at timestamptz,
  UNIQUE (feed_id, guid)
);

CREATE TABLE IF NOT EXISTS queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid REFERENCES episodes(id) ON DELETE SET NULL,
  title text NOT NULL,
  audio_url text NOT NULL,
  source text NOT NULL CHECK (source IN ('feed', 'upload')),
  position int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'downloaded', 'transcribed', 'listening', 'done')),
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS queue_items_audio_url_idx ON queue_items (audio_url);

CREATE TABLE IF NOT EXISTS transcripts (
  queue_item_id uuid PRIMARY KEY REFERENCES queue_items(id) ON DELETE CASCADE,
  engine text,
  duration_ms int,
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_item_id uuid NOT NULL REFERENCES queue_items(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  audio_position_ms int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS conversations_queue_item_idx ON conversations (queue_item_id);

CREATE TABLE IF NOT EXISTS turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  text text NOT NULL,
  audio_position_ms int NOT NULL DEFAULT 0,
  segment_start_ms int,
  segment_end_ms int,
  context_excerpt text,
  engine text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS turns_conversation_idx ON turns (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  secret text NOT NULL DEFAULT '',
  events text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status_code int,
  ok boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_created_idx ON webhook_deliveries (created_at DESC);
