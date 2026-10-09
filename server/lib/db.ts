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
  return new Pool({
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    max: 5,
  });
}

export function getPool(): Pool {
  if (!globalThis.__podtalkPool) globalThis.__podtalkPool = createPool();
  return globalThis.__podtalkPool;
}

/** Applies db/schema.sql once per process (idempotent CREATE IF NOT EXISTS), so a fresh Neon database works on the first request. */
export function ensureSchema(): Promise<void> {
  if (!globalThis.__podtalkSchema) {
    globalThis.__podtalkSchema = (async () => {
      const file = path.join(process.cwd(), "db", "schema.sql");
      const sql = fs.readFileSync(file, "utf8");
      await getPool().query(sql);
    })().catch((err) => {
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
