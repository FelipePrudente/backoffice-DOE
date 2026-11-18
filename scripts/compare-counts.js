import { loadEnv } from "../lib/env.js";
import { query, getPool } from "../lib/db.js";

loadEnv();

const day = process.argv[2] || "2026-07-22";

const { rows } = await query(
  `
  SELECT
    COUNT(*) FILTER (WHERE created_day = $1::date)::int AS day_utc,
    COUNT(*) FILTER (
      WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
    )::int AS day_brt,
    COUNT(*) FILTER (
      WHERE created_day = $1::date AND status_value = 3
    )::int AS st3_utc,
    COUNT(*) FILTER (
      WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
        AND status_value = 3
    )::int AS st3_brt,
    COUNT(*) FILTER (
      WHERE created_day = $1::date AND is_immediate
    )::int AS imm_utc,
    COUNT(*) FILTER (
      WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
        AND is_immediate
    )::int AS imm_brt,
    COUNT(*) FILTER (
      WHERE created_day = $1::date AND status_value = 3 AND is_immediate
    )::int AS st3_imm_utc,
    COUNT(*) FILTER (
      WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
        AND status_value = 3 AND is_immediate
    )::int AS st3_imm_brt,
    COUNT(*) FILTER (
      WHERE created_day = $1::date AND status_value = 4 AND is_immediate
    )::int AS st4_imm_utc
  FROM publications
`,
  [day]
);

console.log("day", day, rows[0]);

const { rows: mismatch } = await query(
  `
  SELECT COUNT(*)::int AS n
  FROM publications
  WHERE created_day IS DISTINCT FROM (created_at AT TIME ZONE 'America/Sao_Paulo')::date
    AND (
      created_day = $1::date
      OR (created_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
    )
`,
  [day]
);
console.log("utc_vs_brt_mismatch_touching_day", mismatch[0].n);

const { rows: byStatus } = await query(
  `
  SELECT status_value, status_caption, COUNT(*)::int AS n,
    COUNT(*) FILTER (WHERE is_immediate)::int AS imm
  FROM publications
  WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
  GROUP BY status_value, status_caption
  ORDER BY status_value
`,
  [day]
);
console.log("by_status_brt", byStatus);

await getPool().end();
