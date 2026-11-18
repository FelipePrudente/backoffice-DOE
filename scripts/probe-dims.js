import { loadEnv } from "../lib/env.js";
import { query, getPool } from "../lib/db.js";

loadEnv();
const { rows } = await query(`
  SELECT payload
  FROM publications
  WHERE payload::text ILIKE '%height%'
  ORDER BY created_at DESC
  LIMIT 1
`);
if (!rows[0]) {
  console.log("none");
  await getPool().end();
  process.exit(0);
}
const p = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
const keys = Object.keys(p).filter((k) =>
  /height|width|pay|disc|valor|price|cost/i.test(k)
);
console.log("keys:", keys.join(", "));
console.log(
  JSON.stringify(
    {
      height: p.height,
      width: p.width,
      paymentTypeName: p.paymentTypeName,
      discountValue: p.discountValue,
      discontValue: p.discontValue
    },
    null,
    2
  )
);
await getPool().end();
