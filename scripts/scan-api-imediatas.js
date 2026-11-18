/**
 * Scan DOE API for one day counting isImmediate, with timeout+retry.
 * Usage: node scripts/scan-api-imediatas.js 2026-08-06
 */
import { loadEnv } from "../lib/env.js";

loadEnv();
if (process.env.DOE_ALLOW_INSECURE_TLS === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const day = process.argv[2] || "2026-08-06";
const PAGE_SIZE = Number(process.env.DOE_PAGE_SIZE || 50);
const DOE =
  "https://do-api-backoffice-taxonomy.doe.sp.gov.br/v1/publication/filter";
const ALL_STATUSES = [3, 4, 5, 8, 9];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    console.log(`→ page ${page} attempt ${attempt}`);
    const res = await fetch(`${DOE}?${params}`, {
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        origin: "https://backoffice.doe.sp.gov.br"
      }
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return data.pagedResult || data;
  } catch (err) {
    if (attempt < 5) {
      const wait = attempt * 3000;
      console.log(`  retry in ${wait}ms: ${err.message}`);
      await sleep(wait);
      return fetchPage(page, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const imm = [];
const first = await fetchPage(1);
const totalPages = first.totalPages || 1;
console.log({ totalItems: first.totalItems, totalPages, PAGE_SIZE });

async function collect(pr, page) {
  let n = 0;
  for (const it of pr.items || []) {
    if (!it.isImmediate) continue;
    n += 1;
    imm.push({
      id: it.id,
      auth: it.authCode,
      title: (it.title || "").slice(0, 60),
      status: it.status && it.status.value,
      schedule: it.schedule || null
    });
  }
  console.log(
    `← page ${page}/${totalPages} items=${(pr.items || []).length} imm+=${n} totalImm=${imm.length}`
  );
}

await collect(first, 1);
for (let page = 2; page <= totalPages; page++) {
  const pr = await fetchPage(page);
  await collect(pr, page);
  await sleep(250);
}

const schedNull = imm.filter((x) => !x.schedule).length;
const schedSame = imm.filter((x) => x.schedule === day).length;
const schedOther = imm.length - schedNull - schedSame;

console.log("\n=== RESULTADO API ===");
console.log({
  day,
  apiTotalItems: first.totalItems,
  apiImm: imm.length,
  schedSame,
  schedNull,
  schedOther
});
console.log("\nlista:");
for (const it of imm) {
  console.log(
    `st${it.status} ${(it.auth || "—").padEnd(14)} sched=${it.schedule || "null"} | ${it.title}`
  );
}
