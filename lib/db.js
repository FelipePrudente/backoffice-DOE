import pg from "pg";
import { loadEnv } from "./env.js";

loadEnv();

const { Pool } = pg;

let pool;

export function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error("DATABASE_URL não encontrada. Rode: npx neonctl env pull");
  }
  const insecure =
    process.env.DOE_ALLOW_INSECURE_TLS === "1" ||
    process.env.DOE_ALLOW_INSECURE_TLS === "true";

  pool = new Pool({
    connectionString: url,
    ssl: insecure ? { rejectUnauthorized: false } : true,
    max: 5
  });
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}
