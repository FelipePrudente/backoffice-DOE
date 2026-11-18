import { loadEnv } from "../lib/env.js";

loadEnv();
if (process.env.DOE_ALLOW_INSECURE_TLS === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const day = process.argv[2] || "2026-09-08";
const status = process.argv[3] || "7";
const DOE =
  "https://do-api-backoffice-taxonomy.doe.sp.gov.br/v1/publication/filter";

const params = new URLSearchParams();
params.set("pageNumber", "1");
params.set("PageSize", "25");
params.set("SortByField", "createdAt");
params.set("SortOrder", "desc");
params.set("InitialDate", day);
params.set("FinalDate", day);
params.append("Status[0]", status);

const res = await fetch(`${DOE}?${params}`, {
  headers: {
    accept: "application/json",
    origin: "https://backoffice.doe.sp.gov.br"
  }
});
const data = await res.json();
const pr = data.pagedResult || data;
console.log({ ok: res.ok, total: pr.totalItems, status });
for (const it of pr.items || []) {
  console.log(
    JSON.stringify(
      {
        id: it.id,
        auth: it.authCode,
        title: it.title,
        status: it.status,
        createdAt: it.createdAt,
        schedule: it.schedule,
        isImmediate: it.isImmediate,
        journal: it.journal && it.journal.name,
        section: it.sectionHierarchy || it.sectionCode,
        publisher: it.publisher && it.publisher.name,
        publicationDate: it.publicationDate,
        pendingPublicationDate: it.pendingPublicationDate,
        paymentType: it.paymentTypeName || it.paymentType,
        keys: Object.keys(it).sort()
      },
      null,
      2
    )
  );
}
