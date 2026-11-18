import { loadEnv } from "../lib/env.js";
loadEnv();
if (process.env.DOE_ALLOW_INSECURE_TLS === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const day = process.argv[2] || "2026-07-22";
const status = process.argv[3] || "3";

async function fetchPage(page) {
  const params = new URLSearchParams();
  params.set("pageNumber", String(page));
  params.set("PageSize", "25");
  params.set("SortByField", "createdAt");
  params.set("SortOrder", "desc");
  params.set("InitialDate", day);
  params.set("FinalDate", day);
  params.append("Status[0]", status);
  const url =
    "https://do-api-backoffice-taxonomy.doe.sp.gov.br/v1/publication/filter?" +
    params;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      origin: "https://backoffice.doe.sp.gov.br"
    }
  });
  const data = await res.json();
  return data.pagedResult || data;
}

const first = await fetchPage(1);
console.log({
  totalItems: first.totalItems,
  totalPages: first.totalPages,
  pageSize: (first.items || []).length
});

let imm = 0;
let n = 0;
const immSamples = [];
const pages = Math.min(first.totalPages || 1, 60);
for (let page = 1; page <= pages; page++) {
  const pr = page === 1 ? first : await fetchPage(page);
  const items = pr.items || [];
  for (const it of items) {
    n += 1;
    if (it.isImmediate) {
      imm += 1;
      if (immSamples.length < 10) {
        immSamples.push({
          id: it.id,
          status: it.status && it.status.value,
          createdAt: it.createdAt,
          schedule: it.schedule,
          isImmediate: it.isImmediate
        });
      }
    }
  }
  if (page === 1 || page % 10 === 0 || page === pages) {
    console.log(`page ${page}/${pages} scanned=${n} imm=${imm}`);
  }
  await new Promise((r) => setTimeout(r, 120));
}
console.log("DONE", { scanned: n, imm, immSamples });
