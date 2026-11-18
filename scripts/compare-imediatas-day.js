import { loadEnv } from "../lib/env.js";
import { query, getPool } from "../lib/db.js";

loadEnv();
if (process.env.DOE_ALLOW_INSECURE_TLS === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const day = process.argv[2] || "2026-08-06";
const PAGE_SIZE = Number(process.env.DOE_PAGE_SIZE || 100);
const CONCURRENCY = Number(process.env.DOE_CONCURRENCY || 3);
const DOE =
  "https://do-api-backoffice-taxonomy.doe.sp.gov.br/v1/publication/filter";
const ALL_STATUSES = [3, 4, 5, 8, 9];

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(page, attempt = 1) {
  const params = new URLSearchParams();
  params.set("pageNumber", String(page));
  params.set("PageSize", String(PAGE_SIZE));
  params.set("SortByField", "createdAt");
  params.set("SortOrder", "desc");
  params.set("InitialDate", day);
  params.set("FinalDate", day);
  ALL_STATUSES.forEach((s, i) => params.append(`Status[${i}]`, String(s)));
  try {
    const res = await fetch(`${DOE}?${params}`, {
      headers: {
        accept: "application/json",
        origin: "https://backoffice.doe.sp.gov.br"
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (attempt < 6) {
        await sleep(attempt * 2000);
        return fetchPage(page, attempt + 1);
      }
      throw new Error(`page ${page}: HTTP ${res.status}`);
    }
    return data.pagedResult || data;
  } catch (err) {
    if (attempt < 6) {
      await sleep(attempt * 2000);
      return fetchPage(page, attempt + 1);
    }
    throw err;
  }
}

const { rows: neonSum } = await query(
  `
  SELECT
    COUNT(*)::int AS total_day,
    COUNT(*) FILTER (WHERE is_immediate)::int AS imm,
    COUNT(*) FILTER (WHERE is_immediate AND status_value = 4)::int AS imm_pub,
    COUNT(*) FILTER (WHERE is_immediate AND schedule_day = $1::date)::int AS imm_sched_same,
    COUNT(*) FILTER (WHERE is_immediate AND schedule_day IS NULL)::int AS imm_sched_null,
    COUNT(*) FILTER (
      WHERE is_immediate AND (schedule_day IS NULL OR schedule_day <> $1::date)
    )::int AS imm_sched_not_same
  FROM publications
  WHERE created_day = $1::date
`,
  [day]
);

const { rows: byStatus } = await query(
  `
  SELECT status_value, status_caption, COUNT(*)::int AS n
  FROM publications
  WHERE created_day = $1::date AND is_immediate
  GROUP BY status_value, status_caption
  ORDER BY status_value
`,
  [day]
);

const { rows: neonIds } = await query(
  `
  SELECT id, auth_code, title, status_value, created_at, schedule_day::text
  FROM publications
  WHERE created_day = $1::date AND is_immediate
  ORDER BY created_at
`,
  [day]
);

console.log("=== NEON", day, "===");
console.log(neonSum[0]);
console.log("by_status", byStatus);

console.log("\n=== DOE API (scan isImmediate) ===");
console.log({ PAGE_SIZE, CONCURRENCY });
const first = await fetchPage(1);
const totalPages = Math.min(first.totalPages || 1, 400);
console.log({
  apiTotalItems: first.totalItems,
  totalPages: first.totalPages
});

const apiImm = new Map();
let scanned = 0;
let donePages = 0;

async function consume(pr) {
  for (const it of pr.items || []) {
    scanned += 1;
    if (!it.isImmediate) continue;
    apiImm.set(it.id, {
      id: it.id,
      auth: it.authCode,
      title: it.title,
      status: it.status && it.status.value,
      createdAt: it.createdAt,
      schedule: it.schedule
    });
  }
  donePages += 1;
  if (donePages === 1 || donePages % 5 === 0 || donePages === totalPages) {
    console.log(
      `page progress ${donePages}/${totalPages} scanned=${scanned} imm=${apiImm.size}`
    );
  }
}

await consume(first);

const remaining = [];
for (let p = 2; p <= totalPages; p++) remaining.push(p);

while (remaining.length) {
  const batch = remaining.splice(0, CONCURRENCY);
  const results = await Promise.all(batch.map((p) => fetchPage(p)));
  for (const pr of results) await consume(pr);
  await sleep(80);
}

console.log("API imediatas:", apiImm.size);

const neonSet = new Set(neonIds.map((r) => r.id));
const apiSet = new Set(apiImm.keys());
const onlyApi = [...apiSet].filter((id) => !neonSet.has(id));
const onlyNeon = [...neonSet].filter((id) => !apiSet.has(id));

console.log("\n=== DIFF ===");
console.log({
  neonImm: neonSet.size,
  apiImm: apiSet.size,
  onlyInApi: onlyApi.length,
  onlyInNeon: onlyNeon.length,
  neonTotalDay: neonSum[0].total_day,
  apiTotalDay: first.totalItems
});

if (onlyApi.length) {
  console.log("\nSó na API (faltando no Neon):");
  for (const id of onlyApi) {
    const it = apiImm.get(id);
    console.log(
      "-",
      id.slice(0, 8),
      "st" + it.status,
      (it.title || "").slice(0, 55),
      it.auth,
      "sched=" + (it.schedule || "null")
    );
  }
}
if (onlyNeon.length) {
  console.log("\nSó no Neon (não veio na API do dia):");
  for (const id of onlyNeon) {
    const r = neonIds.find((x) => x.id === id);
    console.log(
      "-",
      id.slice(0, 8),
      "st" + r.status_value,
      (r.title || "").slice(0, 55),
      r.auth_code,
      "sched=" + (r.schedule_day || "null")
    );
  }
}

await getPool().end();
