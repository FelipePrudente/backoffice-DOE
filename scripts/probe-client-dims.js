import { loadEnv } from "../lib/env.js";
import { query, getPool } from "../lib/db.js";

loadEnv();

const { rows } = await query(`
  SELECT id, height, width, payment_type_name, discount_value, payload
  FROM publications
  WHERE payload::text ILIKE '%discontValue%'
  LIMIT 1
`);
const row = rows[0];
const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload || {};
const client = {
  height: row.height || payload.height || null,
  width: row.width || payload.width || null,
  paymentTypeName: row.payment_type_name || payload.paymentTypeName || null,
  discountValue:
    row.discount_value || payload.discontValue || payload.discountValue || null
};
console.log(client);
await getPool().end();
