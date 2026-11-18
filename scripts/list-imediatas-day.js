import { loadEnv } from "../lib/env.js";
import { query, getPool } from "../lib/db.js";

loadEnv();
const day = process.argv[2] || "2026-08-06";

const { rows: sum } = await query(
  `
  SELECT
    COUNT(*)::int AS total_day,
    COUNT(*) FILTER (WHERE is_immediate)::int AS imm,
    COUNT(*) FILTER (WHERE is_immediate AND schedule_day = $1::date)::int AS imm_sched_same,
    COUNT(*) FILTER (WHERE is_immediate AND schedule_day IS NULL)::int AS imm_sched_null,
    COUNT(*) FILTER (
      WHERE is_immediate AND schedule_day IS NOT NULL AND schedule_day <> $1::date
    )::int AS imm_sched_other
  FROM publications
  WHERE created_day = $1::date
`,
  [day]
);

const { rows } = await query(
  `
  SELECT
    auth_code,
    LEFT(title, 60) AS title,
    status_caption,
    schedule_day::text AS schedule_day,
    to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS created_brt,
    CASE
      WHEN schedule_day IS NULL THEN 'sched_null'
      WHEN schedule_day = $1::date THEN 'sched_same'
      ELSE 'sched_other'
    END AS sched_bucket
  FROM publications
  WHERE created_day = $1::date AND is_immediate
  ORDER BY created_at
`,
  [day]
);

console.log("day", day, sum[0]);
console.log("imediatas", rows.length);
for (const r of rows) {
  console.log(
    `${r.sched_bucket.padEnd(12)} ${r.created_brt} ${r.auth_code || "—"} | ${r.title} | sched=${r.schedule_day || "null"}`
  );
}

await getPool().end();
