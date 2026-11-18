import { loadEnv } from "../lib/env.js";
import { query, getPool } from "../lib/db.js";

loadEnv();
if (process.env.DOE_ALLOW_INSECURE_TLS === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const { rows } = await query(`
  SELECT id, title, is_immediate, status_value, status_caption, payload
  FROM publications
  WHERE created_day = CURRENT_DATE
  ORDER BY created_at DESC
  LIMIT 1
`);

if (!rows[0]) {
  console.log("Nenhuma publicação de hoje");
  await getPool().end();
  process.exit(0);
}

const row = rows[0];
const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
console.log("ID:", row.id);
console.log("Title:", row.title);
console.log("Status:", row.status_value, row.status_caption);
console.log("isImmediate:", row.is_immediate);
console.log("Payload keys:", Object.keys(payload).sort().join(", "));
console.log("--- payload sample ---");
console.log(JSON.stringify(payload, null, 2).slice(0, 4000));

const id = row.id;
const bases = [
  "https://do-api-backoffice-taxonomy.doe.sp.gov.br/v1",
  "https://do-api-backoffice-taxonomy.doe.sp.gov.br/v2",
  "https://backoffice.doe.sp.gov.br/api/v1"
];
const paths = [
  `/publication/${id}/audit`,
  `/publication/${id}/history`,
  `/publication/${id}/auditing`,
  `/auditing/publication/${id}`,
  `/audit/publication/${id}`,
  `/publication/audit/${id}`,
  `/publication/history/${id}`,
  `/audit?publicationId=${id}`,
  `/auditing?entityId=${id}`,
  `/publication/${id}`
];

for (const base of bases) {
  for (const path of paths) {
    const url = base + path;
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          origin: "https://backoffice.doe.sp.gov.br"
        }
      });
      const text = await res.text();
      if (res.status !== 404) {
        console.log(res.status, url, text.slice(0, 200).replace(/\s+/g, " "));
      }
    } catch (e) {
      console.log("ERR", url, e.message);
    }
  }
}

await getPool().end();
