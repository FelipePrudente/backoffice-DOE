/**
 * Relatório de imediatas do dia → Microsoft Teams (Power Automate webhook).
 *
 * Recorte: created_day = hoje (BRT) AND is_immediate
 * (não exige schedule — muitas imediatas vêm com schedule nulo)
 * Link público DOE:
 *   https://www.doe.sp.gov.br/{caderno}/{seção}/{titulo}-{authSemPontos}
 *   seção = 2º nível da sectionHierarchy (ex.: Secretaria da Educação)
 *
 * Uso:
 *   npm run report:imediatas           # sync leve + envia
 *   npm run report:imediatas -- --dry-run
 *   npm run report:imediatas -- --no-sync
 */
import { loadEnv } from "../lib/env.js";
import { query, getPool } from "../lib/db.js";
import { runSync } from "../sync.js";

loadEnv();

const WEBHOOK = (process.env.TEAMS_WEBHOOK_URL || "").trim();
const dryRun = process.argv.includes("--dry-run");
const noSync = process.argv.includes("--no-sync");
const MAX_CHARS = 12000;
const ITEM_SEP = "<br><br>";

function todayBRT() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo"
  }).format(new Date());
}

function formatDateBR(isoDay) {
  if (!isoDay) return "—";
  const [y, m, d] = String(isoDay).slice(0, 10).split("-");
  if (!y || !m || !d) return String(isoDay);
  return `${d}/${m}/${y}`;
}

function formatDateTimeBR(v, withSeconds = false) {
  if (v == null || v === "") return "—";
  const dt = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(dt.getTime())) return String(v);
  const opts = {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  };
  if (withSeconds) opts.second = "2-digit";
  return dt.toLocaleString("pt-BR", opts);
}

function toMs(v) {
  if (v == null || v === "") return NaN;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
}

function deltaMinutes(a, b) {
  const ma = toMs(a);
  const mb = toMs(b);
  if (!Number.isFinite(ma) || !Number.isFinite(mb)) return null;
  return Math.max(0, Math.round(Math.abs(mb - ma) / 60000));
}

function slugify(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function buildDoeUrl(row) {
  const authDigits = String(row.auth_code || "").replace(/\D/g, "");
  if (!authDigits) return null;
  const journal = slugify(row.journal_name) || "diario";
  const hier = String(row.section_hierarchy || "")
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean);
  const section = slugify(hier[1] || hier[0] || "publicacao");
  const title = slugify(row.title) || "publicacao";
  return `https://www.doe.sp.gov.br/${journal}/${section}/${title}-${authDigits}`;
}

function maskDoc(doc) {
  const d = String(doc || "").replace(/\D/g, "");
  if (d.length < 4) return doc || "—";
  return "***" + d.slice(-4);
}

/** Agrupa blocos inteiros sem cortar no meio de uma matéria. */
function chunkBlocks(header, blocks, max) {
  if (!blocks.length) return [header];
  const parts = [];
  let current = header;
  for (const block of blocks) {
    const next =
      current === header
        ? header + "<br><br>" + block
        : current + ITEM_SEP + block;
    if (next.length > max && current !== header) {
      parts.push(current);
      current = header + `<br><em>(continuação)</em><br><br>` + block;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

async function fetchImediatas(day) {
  const { rows } = await query(
    `
    SELECT
      id, title, auth_code, schedule, created_at, pending_publication_date,
      status_caption, journal_name, section_hierarchy, section_code,
      publisher_name, publisher_document, publication_type_name, payload
    FROM publications
    WHERE is_immediate = TRUE
      AND created_day = $1::date
    ORDER BY created_at ASC
  `,
    [day]
  );
  return rows;
}

function breadcrumb(row) {
  const journal = row.journal_name || "—";
  const top = String(row.section_hierarchy || "")
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean)[0];
  return top ? `${journal} › ${top}` : journal;
}

function buildItems(rows) {
  return rows.map((row, idx) => {
    const payload =
      typeof row.payload === "string"
        ? JSON.parse(row.payload || "{}")
        : row.payload || {};
    const publishedAt =
      payload.publicationDate ||
      row.pending_publication_date ||
      row.created_at;
    const createdAt = row.created_at;
    const delta = deltaMinutes(createdAt, publishedAt);
    const status = row.status_caption || "";
    const valida = /publicad/i.test(status) ? "Válida" : status || "—";
    const sectionName =
      payload.sectionName ||
      String(row.section_hierarchy || "")
        .split("/")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(-1)[0] ||
      "—";

    return {
      n: idx + 1,
      id: row.id,
      title: row.title || "—",
      authCode: row.auth_code || "—",
      status,
      valida,
      publishedAt,
      publishedLabel: formatDateTimeBR(publishedAt),
      deltaMin: delta,
      breadcrumb: breadcrumb(row),
      journalName: row.journal_name || "—",
      sectionName,
      sectionHierarchy: row.section_hierarchy || "—",
      publisherName: row.publisher_name || "—",
      link: buildDoeUrl(row)
    };
  });
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Formato monitor (★ título · breadcrumb · Publicado/Assinado/Δ/link). */
function buildHeaderHtml(day, total) {
  const now = formatDateTimeBR(new Date(), true);
  return (
    `Monitor automático · ${esc(now)}<br><br>` +
    `<strong>Edição:</strong> ${esc(day)}<br>` +
    `<strong>Gerado em:</strong> ${esc(now)}<br>` +
    `<strong>Imediatas:</strong> ${total} | <strong>Novas:</strong> ${total} | <strong>Irregulares:</strong> 0<br>`
  );
}

function buildItemHtml(it) {
  const link = it.link
    ? `<a href="${esc(it.link)}">Abrir matéria</a>`
    : "Abrir matéria";
  const meta = [
    `Publicado: ${esc(it.publishedLabel)}`,
    esc(it.valida),
    link
  ].join(" · ");

  return (
    `★ <strong>${esc(it.title)}</strong><br>` +
    `${esc(it.breadcrumb)}<br>` +
    meta +
    `<br>` +
    `<strong>Id da publicação:</strong> ${esc(it.authCode)} · ` +
    `<strong>Caderno:</strong> ${esc(it.journalName)} · ` +
    `<strong>Seção:</strong> ${esc(it.sectionName)} · ` +
    `<strong>Publicante:</strong> ${esc(it.publisherName)}`
  );
}

async function postTeams(payload) {
  if (!WEBHOOK) {
    throw new Error(
      "TEAMS_WEBHOOK_URL não configurada. Defina no .env.local ou nos Secrets do Actions."
    );
  }
  const title = payload.title;
  const html = payload.html || payload.text || "";
  const body = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor: "836FFF",
    summary: payload.summary || title,
    title,
    text: html,
    message: html,
    count: payload.count,
    day: payload.day
  };
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Webhook Teams HTTP ${res.status}: ${text.slice(0, 300)}`
    );
  }
  console.log(
    `Webhook HTTP ${res.status}` + (text ? `: ${text.slice(0, 120)}` : " (aceito)")
  );
  return text;
}

async function main() {
  const day = todayBRT();
  console.log(`Relatório imediatas — dia BRT ${day}`);

  if (!noSync && !dryRun) {
    console.log("Sync incremental antes do relatório…");
    try {
      const r = await runSync({ forceSeed: false });
      console.log(`Sync OK (${r.mode}): +${r.upserted}`);
    } catch (err) {
      console.warn("Sync falhou (seguindo com Neon atual):", err.message || err);
    }
  }

  const rows = await fetchImediatas(day);
  const items = buildItems(rows);
  const header = buildHeaderHtml(day, items.length);
  const blocks = items.length
    ? items.map(buildItemHtml)
    : ["Nenhuma imediata encontrada com este recorte."];
  const parts = chunkBlocks(header, blocks, MAX_CHARS);

  console.log(`Imediatas encontradas: ${items.length}`);
  console.log(`Partes da mensagem: ${parts.length}`);

  const basePayload = {
    title: "Relatório — Publicações Imediatas DOE-SP",
    count: items.length,
    day,
    generatedAt: new Date().toISOString(),
    items
  };

  if (dryRun) {
    console.log("--- DRY RUN (não envia) ---");
    console.log(parts[0].slice(0, 2000));
    if (parts[0].length > 2000) console.log("…");
    return;
  }

  for (let i = 0; i < parts.length; i++) {
    const partLabel =
      parts.length > 1 ? ` (${i + 1}/${parts.length})` : "";
    await postTeams({
      ...basePayload,
      part: i + 1,
      parts: parts.length,
      html: parts[i],
      summary: `${basePayload.title} · ${items.length} imediatas · ${day}${partLabel}`
    });
    console.log(`Enviado ao Teams${partLabel}`);
  }
}

main()
  .catch((err) => {
    console.error("Erro no relatório:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getPool().end();
    } catch (_) {
      /* ignore */
    }
  });
