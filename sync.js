import { pathToFileURL } from "url";
import { resolve } from "path";
import { loadEnv } from "./lib/env.js";
import { query, getPool } from "./lib/db.js";

loadEnv();

const DOE_API =
  process.env.DOE_API ||
  "https://do-api-backoffice-taxonomy.doe.sp.gov.br/v1";
const ALL_STATUSES = [3, 4, 5, 8, 9];
const LOOKBACK_DAYS = Number(process.env.DOE_LOOKBACK_DAYS || 5);
/** Retenção: apaga matérias com created_at / created_day mais antigos que N dias. */
const RETENTION_DAYS = Number(process.env.DOE_RETENTION_DAYS || 10);
/**
 * Reconcile: rebaixa N dias (hoje inclusive) para atualizar status/preencher buracos.
 * Padrão 3 = hoje + 2 anteriores (evita status “preso” em Pendente).
 */
const RECONCILE_DAYS = Math.max(
  1,
  Number(process.env.DOE_RECONCILE_DAYS || 3)
);
const PAGE_SIZE = Number(process.env.DOE_PAGE_SIZE || 25);

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysISO(isoDay, delta) {
  const [y, m, d] = isoDay.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return toISODate(dt);
}

function dayOf(iso) {
  return iso ? String(iso).slice(0, 10) : null;
}

function toMs(v) {
  if (v == null || v === "") return NaN;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
}

function toISOTimestamp(v) {
  const ms = toMs(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "") || null;
}

function mapRow(it) {
  return {
    id: it.id,
    title: it.title || null,
    schedule: it.schedule || null,
    schedule_day: dayOf(it.schedule),
    created_at: it.createdAt,
    created_day: dayOf(it.createdAt),
    is_immediate: !!it.isImmediate,
    status_value: it.status && it.status.value != null ? it.status.value : null,
    status_caption:
      (it.status && (it.status.caption || it.status.name)) || null,
    journal_id: it.journalId || null,
    journal_name: it.journalName || null,
    section_code: it.sectionCode || null,
    section_hierarchy: it.sectionHierarchy || it.sectionName || null,
    publisher_name: it.publisherName || null,
    publisher_document: it.publisherDocument || null,
    publisher_document_digits: digitsOnly(it.publisherDocument),
    auth_code: it.authCode || null,
    publication_type_name: it.publicationTypeName || null,
    height: it.height != null ? String(it.height) : null,
    width: it.width != null ? String(it.width) : null,
    payment_type_name: it.paymentTypeName || null,
    discount_value:
      it.discontValue != null
        ? String(it.discontValue)
        : it.discountValue != null
          ? String(it.discountValue)
          : null,
    pending_publication_date: it.pendingPublicationDate || null,
    payload: JSON.stringify(it)
  };
}

async function fetchPage(pageNumber, initialDate, finalDate) {
  const params = new URLSearchParams();
  params.set("pageNumber", String(pageNumber));
  params.set("PageSize", String(PAGE_SIZE));
  params.set("SortByField", "createdAt");
  params.set("SortOrder", "desc");
  params.set("InitialDate", initialDate);
  params.set("FinalDate", finalDate);
  ALL_STATUSES.forEach((s, i) => params.append(`Status[${i}]`, String(s)));

  const url = `${DOE_API}/publication/filter?${params}`;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          origin: "https://backoffice.doe.sp.gov.br"
        }
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        /* ignore */
      }
      if (!res.ok) {
        const detail = (data && (data.detail || data.title)) || text || "";
        throw new Error(`HTTP ${res.status} — ${String(detail).slice(0, 200)}`);
      }
      return (data && (data.pagedResult || data)) || {};
    } catch (err) {
      lastErr = err;
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
    }
  }
  throw lastErr;
}

async function fetchAll(initialDate, finalDate, onProgress) {
  const collected = [];
  const seen = new Set();
  let page = 1;
  const safetyMax = 800;

  while (page <= safetyMax) {
    const pr = await fetchPage(page, initialDate, finalDate);
    const items = pr.items || [];
    for (const it of items) {
      if (!it || !it.id || seen.has(it.id)) continue;
      seen.add(it.id);
      collected.push(it);
    }
    if (onProgress) onProgress(page, pr.totalPages || null, collected.length, pr.totalItems);

    const fullPage = items.length >= PAGE_SIZE;
    const hasMore =
      pr.hasNextPage === true ||
      (pr.hasNextPage !== false && fullPage) ||
      (page < (pr.totalPages || 1));

    if (!hasMore || items.length === 0) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 200));
  }
  return collected;
}

async function upsertBatch(rows) {
  if (!rows.length) return 0;
  const cols = [
    "id",
    "title",
    "schedule",
    "schedule_day",
    "created_at",
    "created_day",
    "is_immediate",
    "status_value",
    "status_caption",
    "journal_id",
    "journal_name",
    "section_code",
    "section_hierarchy",
    "publisher_name",
    "publisher_document",
    "publisher_document_digits",
    "auth_code",
    "publication_type_name",
    "height",
    "width",
    "payment_type_name",
    "discount_value",
    "pending_publication_date",
    "payload",
    "synced_at"
  ];

  const values = [];
  const params = [];
  let i = 1;
  for (const r of rows) {
    const placeholders = [];
    for (const c of cols) {
      if (c === "synced_at") {
        placeholders.push("NOW()");
        continue;
      }
      if (c === "payload") {
        placeholders.push(`$${i}::jsonb`);
        params.push(r.payload);
        i += 1;
        continue;
      }
      placeholders.push(`$${i}`);
      params.push(r[c]);
      i += 1;
    }
    values.push(`(${placeholders.join(",")})`);
  }

  const sql = `
    INSERT INTO publications (${cols.join(",")})
    VALUES ${values.join(",")}
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      schedule = EXCLUDED.schedule,
      schedule_day = EXCLUDED.schedule_day,
      created_at = EXCLUDED.created_at,
      created_day = EXCLUDED.created_day,
      is_immediate = EXCLUDED.is_immediate,
      status_value = EXCLUDED.status_value,
      status_caption = EXCLUDED.status_caption,
      journal_id = EXCLUDED.journal_id,
      journal_name = EXCLUDED.journal_name,
      section_code = EXCLUDED.section_code,
      section_hierarchy = EXCLUDED.section_hierarchy,
      publisher_name = EXCLUDED.publisher_name,
      publisher_document = EXCLUDED.publisher_document,
      publisher_document_digits = EXCLUDED.publisher_document_digits,
      auth_code = EXCLUDED.auth_code,
      publication_type_name = EXCLUDED.publication_type_name,
      height = EXCLUDED.height,
      width = EXCLUDED.width,
      payment_type_name = EXCLUDED.payment_type_name,
      discount_value = EXCLUDED.discount_value,
      pending_publication_date = EXCLUDED.pending_publication_date,
      payload = EXCLUDED.payload,
      synced_at = NOW()
  `;
  await query(sql, params);
  return rows.length;
}

async function getSyncState() {
  const { rows } = await query("SELECT * FROM sync_state WHERE id = 'default'");
  return rows[0] || null;
}

async function updateSyncState({ seededAt, maxCreatedAt, itemCount }) {
  await query(
    `UPDATE sync_state SET
      seeded_at = COALESCE($1, seeded_at),
      last_sync_at = NOW(),
      max_created_at = CASE
        WHEN $2::timestamptz IS NULL THEN max_created_at
        WHEN max_created_at IS NULL THEN $2::timestamptz
        WHEN $2::timestamptz > max_created_at THEN $2::timestamptz
        ELSE max_created_at
      END,
      item_count = COALESCE($3, item_count),
      lookback_days = $4
     WHERE id = 'default'`,
    [seededAt || null, maxCreatedAt || null, itemCount ?? null, LOOKBACK_DAYS]
  );
}

/**
 * Remove publicações com data de criação anterior à janela de retenção (padrão: 10 dias).
 */
export async function purgeOldPublications() {
  const days = RETENTION_DAYS;
  const { rowCount } = await query(
    `DELETE FROM publications
     WHERE created_day IS NOT NULL
       AND created_day < (CURRENT_DATE - $1::int)`,
    [days]
  );
  // Fallback se created_day estiver nulo em algum registro legado
  const { rowCount: rowCount2 } = await query(
    `DELETE FROM publications
     WHERE created_day IS NULL
       AND created_at < (CURRENT_TIMESTAMP - ($1::text || ' days')::interval)`,
    [days]
  );
  return (rowCount || 0) + (rowCount2 || 0);
}

/**
 * Baixa páginas da API e grava no Neon.
 * @param {object} opts
 * @param {string} opts.initialDate
 * @param {string} opts.finalDate
 * @param {(row: object) => boolean} [opts.acceptRow] — se false, descarta o item
 * @param {boolean} [opts.earlyExitWhenBatchEmpty] — para em createdAt desc quando a página não tem novidade
 * @param {boolean} [opts.markSeeded]
 */
async function pullAndUpsert({
  initialDate,
  finalDate,
  acceptRow,
  earlyExitWhenBatchEmpty = false,
  markSeeded = false
}) {
  let upserted = 0;
  let fetched = 0;
  const seen = new Set();
  let page = 1;
  const safetyMax = 800;

  while (page <= safetyMax) {
    const pr = await fetchPage(page, initialDate, finalDate);
    const items = pr.items || [];
    const batch = [];

    for (const it of items) {
      if (!it || !it.id || seen.has(it.id)) continue;
      seen.add(it.id);
      fetched += 1;
      const row = mapRow(it);
      if (!row.id || !row.created_at) continue;
      if (acceptRow && !acceptRow(row)) continue;
      batch.push(row);
    }

    for (let i = 0; i < batch.length; i += 40) {
      upserted += await upsertBatch(batch.slice(i, i + 40));
    }

    process.stdout.write(
      `\rPágina ${page}${pr.totalPages ? "/" + pr.totalPages : ""} · ` +
        `API ${fetched} · Neon +${upserted}` +
        (pr.totalItems != null ? ` (API ~${pr.totalItems})` : "") +
        "   "
    );

    if (page === 1 || page % 10 === 0) {
      const { rows: countRows } = await query(
        "SELECT COUNT(*)::int AS n FROM publications"
      );
      const { rows: maxRows } = await query(
        "SELECT MAX(created_at) AS max FROM publications"
      );
      await updateSyncState({
        seededAt: markSeeded ? new Date().toISOString() : null,
        maxCreatedAt: maxRows[0].max,
        itemCount: countRows[0].n
      });
    }

    if (earlyExitWhenBatchEmpty && items.length > 0 && batch.length === 0) {
      console.log(`\nNada novo após página ${page} — encerrando complemento.`);
      break;
    }

    const fullPage = items.length >= PAGE_SIZE;
    const hasMore =
      pr.hasNextPage === true ||
      (pr.hasNextPage !== false && fullPage) ||
      (page < (pr.totalPages || 1));

    if (!hasMore || items.length === 0) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 150));
  }
  process.stdout.write("\n");

  return { fetched, upserted, pages: page };
}

export async function runSync({ forceSeed = false, reconcileToday = false } = {}) {
  const today = toISODate(new Date());
  let state = await getSyncState();
  const hasSeed = !!(state && state.seeded_at && state.max_created_at);
  const doSeed = forceSeed || !hasSeed;

  let fetched = 0;
  let upserted = 0;
  let mode;
  let markSeeded = false;

  if (doSeed) {
    mode = "seed";
    const initialDate = addDaysISO(today, -LOOKBACK_DAYS);
    const finalDate = today;
    markSeeded = true;
    const seedStart = initialDate;
    console.log(`Carga inicial: createdAt ${initialDate} → ${finalDate}`);
    const r = await pullAndUpsert({
      initialDate,
      finalDate,
      acceptRow: (row) =>
        !!(row.created_day && row.created_day >= seedStart && row.created_day <= today),
      markSeeded: true
    });
    fetched += r.fetched;
    upserted += r.upserted;
  } else if (reconcileToday) {
    mode = "reconcile";
    // Dia a dia: a API DOE subconta/limita em intervalos longos.
    const start = addDaysISO(today, -(RECONCILE_DAYS - 1));
    console.log(
      `Reconcile ${RECONCILE_DAYS}d (dia a dia): ${start} → ${today}`
    );
    for (let i = 0; i < RECONCILE_DAYS; i++) {
      const day = addDaysISO(start, i);
      console.log(`— Reconcile dia ${day}`);
      const r = await pullAndUpsert({
        initialDate: day,
        finalDate: day,
        acceptRow: (row) => !row.created_day || row.created_day === day
      });
      fetched += r.fetched;
      upserted += r.upserted;
    }
  } else {
    mode = "incremental";
    const max = state.max_created_at;
    const initialDate = dayOf(max) || today;
    const prevMaxMs = toMs(max);
    console.log(`Complemento: a partir de ${toISOTimestamp(max) || max}`);
    const r = await pullAndUpsert({
      initialDate,
      finalDate: today,
      earlyExitWhenBatchEmpty: true,
      acceptRow: (row) => {
        if (!Number.isFinite(prevMaxMs)) return true;
        const createdMs = toMs(row.created_at);
        return Number.isFinite(createdMs) && createdMs > prevMaxMs;
      }
    });
    fetched += r.fetched;
    upserted += r.upserted;
  }

  const purged = await purgeOldPublications();
  if (purged > 0) {
    console.log(`Retenção ${RETENTION_DAYS}d: removidas ${purged} matérias antigas (created_at).`);
  }

  const { rows: countRows } = await query(
    "SELECT COUNT(*)::int AS n FROM publications"
  );
  const itemCount = countRows[0].n;
  const { rows: maxRows } = await query(
    "SELECT MAX(created_at) AS max FROM publications"
  );
  const maxCreatedAt = maxRows[0].max;

  await updateSyncState({
    seededAt: markSeeded ? new Date().toISOString() : null,
    maxCreatedAt,
    itemCount
  });

  state = await getSyncState();
  return {
    mode,
    fetched,
    upserted,
    purged,
    retentionDays: RETENTION_DAYS,
    reconcileDays: RECONCILE_DAYS,
    itemCount,
    maxCreatedAt,
    syncState: state
  };
}

async function main() {
  const forceSeed = process.argv.includes("--seed");
  const reconcileToday = process.argv.includes("--reconcile");
  try {
    const result = await runSync({ forceSeed, reconcileToday });
    console.log(
      `Pronto (${result.mode}): +${result.upserted} gravados · total no Neon: ${result.itemCount}`
    );
  } finally {
    await getPool().end();
  }
}

const isDirect =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirect) {
  main().catch((err) => {
    console.error("Erro no sync:", err.message || err);
    process.exit(1);
  });
}
