import { loadEnv } from "../lib/env.js";
import { query, getPool } from "../lib/db.js";

loadEnv();
const { rows } = await query(`
  SELECT id, title, height, width, payment_type_name, payload
  FROM publications
  WHERE height IS NOT NULL OR width IS NOT NULL OR payment_type_name IS NOT NULL
     OR payload::text ILIKE '%payment%'
     OR payload::text ILIKE '%discount%'
     OR payload::text ILIKE '%discont%'
  ORDER BY created_at DESC
  LIMIT 5
`);
for (const row of rows) {
  const p = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  console.log("---", row.id);
  console.log({
    height: row.height || p.height,
    width: row.width || p.width,
    payment_type_name: row.payment_type_name || p.paymentTypeName,
    discountValue: p.discountValue,
    discontValue: p.discontValue,
    paymentValue: p.paymentValue,
    value: p.value,
    price: p.price
  });
  console.log(
    "pay-related keys:",
    Object.keys(p)
      .filter((k) => /pay|disc|valor|price|cost|value|fatur/i.test(k))
      .join(", ")
  );
}
await getPool().end();
