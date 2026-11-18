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

console.log("day", day);

const { rows: byStatus } = await query(
  `
  SELECT status_value, status_caption, COUNT(*)::int AS n,
    COUNT(*) FILTER (WHERE is_immediate)::int AS imm
  FROM publications
  WHERE created_day = $1::date
  GROUP BY 1, 2
  ORDER BY 1
`,
  [day]
);
console.log("by_status", byStatus);

const { rows: totals } = await query(
  `
  SELECT COUNT(*)::int AS total,
    MIN(created_at) AS first_at,
    MAX(created_at) AS last_at
  FROM publications
  WHERE created_day = $1::date
`,
  [day]
);
console.log("totals", totals[0]);

const { rows: distinctCaptions } = await query(
  `
  SELECT DISTINCT status_value, status_caption
  FROM publications
  WHERE created_day >= ($1::date - 10)
  ORDER BY status_value, status_caption
`,
  [day]
);
console.log("captions_last_10d", distinctCaptions);

const { rows: suspect } = await query(
  `
  SELECT
    id,
    auth_code,
    LEFT(title, 80) AS title,
    status_value,
    status_caption,
    is_immediate,
    schedule_day::text AS schedule_day,
    to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS') AS created_brt,
    publisher_name,
    journal_name
  FROM publications
  WHERE created_day = $1::date
    AND (
      status_value NOT IN (3, 4)
      OR status_caption ILIKE '%falha%'
      OR status_caption ILIKE '%erro%'
      OR status_caption ILIKE '%cancel%'
      OR status_caption ILIKE '%rejeit%'
      OR status_caption ILIKE '%inativ%'
      OR status_caption ILIKE '%invalid%'
    )
  ORDER BY created_at
`,
  [day]
);
console.log("suspect_count", suspect.length);
for (const r of suspect) console.log(JSON.stringify(r));

const { rows: pendingOld } = await query(
  `
  SELECT
    auth_code,
    LEFT(title, 70) AS title,
    status_value,
    status_caption,
    is_immediate,
    to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS created_brt
  FROM publications
  WHERE created_day = $1::date
    AND status_value = 3
  ORDER BY created_at
  LIMIT 30
`,
  [day]
);
console.log("pending_sample", pendingOld.length);
for (const r of pendingOld) console.log(JSON.stringify(r));

await getPool().end();
