import { loadEnv } from "../lib/env.js";
import { query, getPool } from "../lib/db.js";

loadEnv();
if (process.env.DOE_ALLOW_INSECURE_TLS === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const { rows } = await query(`
  SELECT id, title, payload
  FROM publications
  WHERE created_day >= CURRENT_DATE - 1
  ORDER BY created_at DESC
  LIMIT 3
`);

const bases = [
  "https://do-api-backoffice-taxonomy.doe.sp.gov.br/v1",
  "https://do-api-backoffice-taxonomy.doe.sp.gov.br",
  "https://do-api-web-search.doe.sp.gov.br/v1",
  "https://do-api-auditing.doe.sp.gov.br/v1",
  "https://do-api-audit.doe.sp.gov.br/v1",
  "https://do-api-backoffice-auditing.doe.sp.gov.br/v1",
  "https://do-api-workflow.doe.sp.gov.br/v1"
];

for (const row of rows) {
  const id = row.id;
  console.log("\n====", id, row.title?.slice(0, 60));

  // Detail endpoint
  for (const base of [
    "https://do-api-backoffice-taxonomy.doe.sp.gov.br/v1",
  ]) {
    const url = `${base}/publication/${id}`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        origin: "https://backoffice.doe.sp.gov.br"
      }
    });
    const text = await res.text();
    console.log("DETAIL", res.status, "len", text.length);
    try {
      const j = JSON.parse(text);
      console.log("DETAIL keys:", Object.keys(j).sort().join(", "));
      console.log(JSON.stringify(j, null, 2).slice(0, 5000));
    } catch {
      console.log(text.slice(0, 500));
    }
  }

  // Try audit-ish hosts
  for (const base of bases) {
    for (const path of [
      `/audit/filter?EntityId=${id}`,
      `/audit/filter?PublicationId=${id}`,
      `/auditing/filter?EntityId=${id}`,
      `/history/filter?EntityId=${id}`,
      `/publication-audit/filter?PublicationId=${id}`,
      `/publication/${id}/audits`,
      `/audits?entityId=${id}`,
      `/AuditLog/filter?EntityId=${id}`
    ]) {
      const url = base + path;
      try {
        const res = await fetch(url, {
          headers: {
            accept: "application/json",
            origin: "https://backoffice.doe.sp.gov.br"
          }
        });
        if (res.status !== 404) {
          const text = await res.text();
          console.log(res.status, url.slice(0, 120), text.slice(0, 180).replace(/\s+/g, " "));
        }
      } catch (e) {
        // DNS failures etc
        if (!String(e.message).includes("getaddrinfo")) {
          console.log("ERR", url.slice(0, 100), e.message);
        }
      }
    }
  }
}

await getPool().end();
