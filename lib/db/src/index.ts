import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

function getConnectionString(): string | null {
  const url = process.env.DATABASE_URL;

  // Fall back to individual PG* vars if DATABASE_URL is absent or uses an
  // obviously-wrong hostname (e.g. a placeholder like "base").
  const badHosts = new Set(["base", "localhost", "127.0.0.1", ""]);
  if (url) {
    try {
      const parsed = new URL(url);
      if (!badHosts.has(parsed.hostname)) return url;
    } catch {
      // malformed URL — fall through to PG* vars
    }
  }

  const host = process.env.PGHOST;
  const port = process.env.PGPORT ?? "5432";
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE;

  if (host && user && database) {
    const auth = password ? `${user}:${encodeURIComponent(password)}` : user;
    return `postgresql://${auth}@${host}:${port}/${database}`;
  }

  return null;
}

const connectionString = getConnectionString();
if (!connectionString) {
  console.warn("[AI Studio] DATABASE_URL not set — database operations will be dormant until configured.");
}

export const pool = new Pool(
  connectionString
    ? { connectionString }
    : { connectionString: "postgresql://postgres:postgres@localhost:5432/postgres" }
);

pool.on("error", (err) => {
  console.warn("[AI Studio] Database pool background error:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
