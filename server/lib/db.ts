import { Pool, type QueryResultRow } from "pg";
import fs from "node:fs";
import path from "node:path";

declare global {
  // eslint-disable-next-line no-var
  var __podtalkPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __podtalkSchema: Promise<void> | undefined;
}

function createPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  // Verify the server certificate by default (Neon chains to public CAs). PGSSL_INSECURE=1 opts out.
  const ssl = isLocal ? undefined : process.env.PGSSL_INSECURE === "1" ? { rejectUnauthorized: false } : true;
  return new Pool({ connectionString: url, ssl, max: 5 });
}

export function getPool(): Pool {
  if (!globalThis.__podtalkPool) globalThis.__podtalkPool = createPool();
  return globalThis.__podtalkPool;
}

// Arbitrary constant; serializes schema application across concurrent cold starts.
const SCHEMA_LOCK_KEY = 7320157;
// 42P07 duplicate_table, 42710 duplicate_object, 23505 unique_violation (pg_type race): another instance won.
const BENIGN_SCHEMA_ERRORS = new Set(["42P07", "42710", "23505"]);

async function applySchema(): Promise<void> {
  const file = path.join(process.cwd(), "db", "schema.sql");
  const sql = fs.readFileSync(file, "utf8");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK_KEY]);
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const code = (err as { code?: string })?.code;
      if (code && BENIGN_SCHEMA_ERRORS.has(code)) return;
      throw err;
    }
  } finally {
    client.release();
  }
}

/** Applies db/schema.sql once per process (idempotent CREATE IF NOT EXISTS), so a fresh Neon database works on the first request. */
export function ensureSchema(): Promise<void> {
  if (!globalThis.__podtalkSchema) {
    globalThis.__podtalkSchema = applySchema().catch((err) => {
      globalThis.__podtalkSchema = undefined;
      throw err;
    });
  }
  return globalThis.__podtalkSchema;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
