// Applies db/schema.sql to DATABASE_URL. Reads .env.local if the env var is unset.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const file = join(root, ".env.local");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvLocal();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (env or .env.local)");
  process.exit(1);
}
const isLocal = /localhost|127\.0\.0\.1/.test(url);
const pool = new pg.Pool({ connectionString: url, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
const sql = readFileSync(join(root, "db", "schema.sql"), "utf8");
try {
  await pool.query(sql);
  console.log("migrated:", url.replace(/\/\/.*@/, "//***@"));
} finally {
  await pool.end();
}
