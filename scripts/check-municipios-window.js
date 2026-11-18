import { loadEnv } from "../lib/env.js";
import { query, getPool } from "../lib/db.js";

loadEnv();

const day = "2026-09-08";

const { rows: byJournal } = await query(
  `
  SELECT journal_name, status_value, status_caption, COUNT(*)::int AS n
  FROM publications
  WHERE created_day = $1::date
    AND journal_name ILIKE '%munic%'
  GROUP BY 1,2,3
  ORDER BY 1,2
`,
  [day]
);
console.log("municipios_by_status", byJournal);

const { rows: aroundFail } = await query(
  `
  SELECT
    auth_code,
    LEFT(title, 70) AS title,
    status_caption,
    journal_name,
    to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS') AS created_brt,
    publisher_name
  FROM publications
  WHERE created_day = $1::date
    AND journal_name ILIKE '%munic%'
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::time
      BETWEEN time '11:20' AND time '11:50'
  ORDER BY created_at
`,
  [day]
);
console.log("municipios_11h20_11h50", aroundFail.length);
for (const r of aroundFail) console.log(JSON.stringify(r));

const { rows: journals } = await query(
  `
  SELECT journal_name, COUNT(*)::int AS n
  FROM publications
  WHERE created_day = $1::date
  GROUP BY 1
  ORDER BY n DESC
`,
  [day]
);
console.log("journals_today", journals);

await getPool().end();
