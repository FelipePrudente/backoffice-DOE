import { readFileSync } from "fs";
import { resolve } from "path";
import { query, getPool } from "../lib/db.js";

const sql = readFileSync(resolve("sql/schema.sql"), "utf8");
await query(sql);
await query(`
  ALTER TABLE publications
  ADD COLUMN IF NOT EXISTS discount_value TEXT
`);
console.log("Schema aplicado com sucesso.");
await getPool().end();
