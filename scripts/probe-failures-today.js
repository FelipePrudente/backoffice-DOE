import { loadEnv } from "../lib/env.js";
import { query, getPool } from "../lib/db.js";

loadEnv();
if (process.env.DOE_ALLOW_INSECURE_TLS === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const day =
  process.argv[2] ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo"
  }).format(new Date());

const DOE =
  "https://do-api-backoffice-taxonomy.doe.sp.gov.br/v1/publication/filter";

async function apiCount(status) {
  const params = new URLSearchParams();
  params.set("pageNumber", "1");
  params.set("PageSize", "5");
  params.set("SortByField", "createdAt");
  params.set("SortOrder", "desc");
  params.set("InitialDate", day);
  params.set("FinalDate", day);
  if (status != null) params.append("Status[0]", String(status));
  const res = await fetch(`${DOE}?${params}`, {
    headers: {
      accept: "application/json",
      origin: "https://backoffice.doe.sp.gov.br"
    }
  });
  const data = await res.json().catch(() => ({}));
  const pr = data.pagedResult || data;
  const sample = (pr.items || []).slice(0, 3).map((it) => ({
    status: it.status,
    title: (it.title || "").slice(0, 50),
    auth: it.authCode,
    hasError: !!(it.error || it.errors || it.failure || it.failReason),
    keys: Object.keys(it).filter((k) =>
      /err|fail|reject|invalid|problem|exception/i.test(k)
    )
  }));
  return {
    ok: res.ok,
    statusParam: status,
    total: pr.totalItems,
    sample
  };
}

console.log("=== API status probe", day, "===");
for (const s of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  try {
    const r = await apiCount(s);
    console.log(JSON.stringify(r));
  } catch (e) {
    console.log(JSON.stringify({ statusParam: s, err: e.message }));
  }
  await new Promise((r) => setTimeout(r, 200));
}

const { rows: irreg } = await query(
  `
  SELECT
    auth_code,
    LEFT(title, 70) AS title,
    status_value,
    status_caption,
    schedule_day::text,
    to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS created_brt,
    publisher_name
  FROM publications
  WHERE created_day = $1::date
    AND is_immediate = FALSE
    AND schedule_day = created_day
  ORDER BY created_at
`,
  [day]
);
console.log("\n=== irregulares (mesmo dia, sem isImmediate)", irreg.length);
for (const r of irreg) console.log(JSON.stringify(r));

const { rows: payloadHits } = await query(
  `
  SELECT
    auth_code,
    LEFT(title, 70) AS title,
    status_value,
    status_caption,
    to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS created_brt,
    LEFT(payload::text, 400) AS payload_snip
  FROM publications
  WHERE created_day = $1::date
    AND (
      payload::text ILIKE '%falha%'
      OR payload::text ILIKE '%\"error\"%'
      OR payload::text ILIKE '%failed%'
      OR payload::text ILIKE '%exception%'
      OR payload::text ILIKE '%rejeit%'
    )
  ORDER BY created_at
  LIMIT 40
`,
  [day]
);
console.log("\n=== payload mentions falha/erro", payloadHits.length);
for (const r of payloadHits) console.log(JSON.stringify(r));

const { rows: cancelRecent } = await query(
  `
  SELECT
    auth_code,
    LEFT(title, 70) AS title,
    status_caption,
    to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS created_brt,
    publisher_name,
    journal_name
  FROM publications
  WHERE created_day = $1::date AND status_value = 5
  ORDER BY created_at DESC
  LIMIT 20
`,
  [day]
);
console.log("\n=== canceladas hoje", cancelRecent.length);
for (const r of cancelRecent) console.log(JSON.stringify(r));

await getPool().end();
