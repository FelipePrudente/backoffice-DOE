import http from "http";
import { URL } from "url";
import { readFileSync, existsSync } from "fs";
import { join, extname, normalize, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnv } from "./lib/env.js";
import { query, getPool } from "./lib/db.js";
import { runSync } from "./sync.js";

loadEnv();

const PORT = Number(process.env.PORT || 3847);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function send(res, status, body) {
  const json = status === 204 ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(json);
}

function sendFile(res, filePath) {
  const ext = extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const data = readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300"
  });
  res.end(data);
}

function tryServeStatic(pathname, res) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  rel = decodeURIComponent(rel);
  // bloqueia path traversal e arquivos sensíveis
  if (
    rel.includes("..") ||
    rel.startsWith("/.") ||
    rel.includes("node_modules") ||
    rel.includes(".env") ||
    rel.endsWith(".sql") ||
    rel.endsWith(".md")
  ) {
    return false;
  }
  const full = normalize(join(PUBLIC_ROOT, rel));
  if (!full.startsWith(normalize(PUBLIC_ROOT))) return false;
  if (!existsSync(full)) return false;
  sendFile(res, full);
  return true;
}

function classifyModality(row) {
  const createdDay = row.created_day
    ? String(row.created_day).slice(0, 10)
    : null;
  const scheduleDay = row.schedule_day
    ? String(row.schedule_day).slice(0, 10)
    : null;
  const sameDay = createdDay && scheduleDay && createdDay === scheduleDay;
  if (row.is_immediate) return { key: "immediate", label: "Imediata" };
  if (!sameDay) return { key: "normal", label: "Normal" };
  return { key: "irregular", label: "Irregular" };
}

function toClientItem(row) {
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload || {});
  const modality = classifyModality(row);
  return {
    id: row.id,
    title: row.title,
    schedule: row.schedule,
    createdAt: row.created_at,
    isImmediate: row.is_immediate,
    status: {
      value: row.status_value,
      caption: row.status_caption
    },
    journalId: row.journal_id,
    journalName: row.journal_name,
    sectionCode: row.section_code,
    sectionHierarchy: row.section_hierarchy,
    publisherName: row.publisher_name,
    publisherDocument: row.publisher_document,
    authCode: row.auth_code,
    publicationTypeName: row.publication_type_name,
    height: row.height || payload.height || null,
    width: row.width || payload.width || null,
    paymentTypeName: row.payment_type_name || payload.paymentTypeName || null,
    discountValue:
      row.discount_value ||
      payload.discontValue ||
      payload.discountValue ||
      null,
    pendingPublicationDate: row.pending_publication_date,
    modalityKey: modality.key,
    modalityLabel: modality.label,
    sectionName: payload.sectionName || null
  };
}

function buildFilters(url) {
  const q = url.searchParams;
  const where = [];
  const params = [];
  let i = 1;

  const scheduleDay = (q.get("scheduleDay") || "").trim();
  const createdDay = (q.get("createdDay") || "").trim();
  const status = (q.get("status") || "").trim();
  const journalId = (q.get("journalId") || "").trim();
  const title = (q.get("title") || "").trim();
  const sectionCode = (q.get("sectionCode") || "").trim();
  const publisher = (q.get("publisher") || "").trim();
  const cpf = (q.get("cpf") || "").replace(/\D/g, "");
  const authCode = (q.get("authCode") || "").trim();
  const publicationId = (q.get("id") || q.get("publicationId") || "").trim();
  const freeText = (q.get("q") || q.get("search") || "").trim();
  const modality = (q.get("modality") || "all").trim();
  const sortBy = q.get("sortBy") === "schedule" ? "schedule" : "created_at";
  const pageSize = Math.min(
    Math.max(Number(q.get("pageSize") || q.get("limit") || 30), 1),
    10000
  );
  const page = Math.max(Number(q.get("page") || 1), 1);
  const offset = (page - 1) * pageSize;
  const skipModality = q.get("skipModality") === "1";

  if (scheduleDay) {
    where.push(`schedule_day = $${i++}::date`);
    params.push(scheduleDay);
  }
  if (createdDay) {
    where.push(`created_day = $${i++}::date`);
    params.push(createdDay);
  }
  if (status && q.get("skipStatus") !== "1") {
    const vals = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length) {
      where.push(`status_value = ANY($${i++}::int[])`);
      params.push(vals.map(Number));
    }
  }
  if (journalId) {
    where.push(`journal_id = $${i++}`);
    params.push(journalId);
  }
  if (title) {
    where.push(`title ILIKE $${i++}`);
    params.push(`%${title}%`);
  }
  if (sectionCode) {
    where.push(`section_code ILIKE $${i++}`);
    params.push(`%${sectionCode}%`);
  }
  if (publisher) {
    where.push(`publisher_name ILIKE $${i++}`);
    params.push(`%${publisher}%`);
  }
  if (cpf) {
    where.push(`publisher_document_digits LIKE $${i++}`);
    params.push(`%${cpf}%`);
  }
  if (authCode) {
    where.push(`auth_code ILIKE $${i++}`);
    params.push(`%${authCode}%`);
  }
  if (publicationId) {
    where.push(`id::text ILIKE $${i++}`);
    params.push(`%${publicationId}%`);
  }
  if (freeText) {
    const dig = freeText.replace(/\D/g, "");
    const likeParam = `$${i++}`;
    params.push(`%${freeText}%`);
    const parts = [
      `title ILIKE ${likeParam}`,
      `section_code ILIKE ${likeParam}`,
      `publisher_name ILIKE ${likeParam}`,
      `auth_code ILIKE ${likeParam}`,
      `id::text ILIKE ${likeParam}`,
      `section_hierarchy ILIKE ${likeParam}`
    ];
    if (dig) {
      parts.push(`publisher_document_digits LIKE $${i++}`);
      params.push(`%${dig}%`);
    }
    where.push(`(${parts.join(" OR ")})`);
  }
  if (!skipModality) {
    if (modality === "immediate") where.push("is_immediate = TRUE");
    else if (modality === "normal") {
      where.push("is_immediate = FALSE");
      where.push("(created_day IS NULL OR schedule_day IS NULL OR created_day <> schedule_day)");
    } else if (modality === "irregular") {
      where.push("is_immediate = FALSE");
      where.push("created_day IS NOT NULL AND schedule_day IS NOT NULL AND created_day = schedule_day");
    }
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
    sortBy,
    page,
    pageSize,
    offset,
    modality
  };
}

async function handlePublications(url, res) {
  const f = buildFilters(url);
  const sql = `
    SELECT * FROM publications
    ${f.whereSql}
    ORDER BY ${f.sortBy} DESC NULLS LAST
    LIMIT ${f.pageSize}
    OFFSET ${f.offset}
  `;
  const countSql = `SELECT COUNT(*)::int AS n FROM publications ${f.whereSql}`;

  // Contagens de tipo: mesmos filtros de data/etc., sem modalidade nem status
  // (alinha ao backoffice antigo: o card Imediatas reflete o dia, não só o status da lista)
  const urlNoMod = new URL(url.href);
  urlNoMod.searchParams.set("skipModality", "1");
  urlNoMod.searchParams.set("skipStatus", "1");
  urlNoMod.searchParams.delete("modality");
  const fCounts = buildFilters(urlNoMod);
  const countsSql = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE is_immediate)::int AS immediate,
      COUNT(*) FILTER (
        WHERE NOT is_immediate
          AND (created_day IS NULL OR schedule_day IS NULL OR created_day <> schedule_day)
      )::int AS normal,
      COUNT(*) FILTER (
        WHERE NOT is_immediate
          AND created_day IS NOT NULL
          AND schedule_day IS NOT NULL
          AND created_day = schedule_day
      )::int AS irregular
    FROM publications
    ${fCounts.whereSql}
  `;

  const [list, countRes, countsRes] = await Promise.all([
    query(sql, f.params),
    query(countSql, f.params),
    query(countsSql, fCounts.params)
  ]);

  const total = countRes.rows[0].n;
  const totalPages = Math.max(1, Math.ceil(total / f.pageSize));

  send(res, 200, {
    total,
    page: f.page,
    pageSize: f.pageSize,
    totalPages,
    counts: countsRes.rows[0],
    items: list.rows.map(toClientItem)
  });
}

async function handleSyncStatus(res) {
  const { rows } = await query("SELECT * FROM sync_state WHERE id = 'default'");
  const { rows: countRows } = await query(
    "SELECT COUNT(*)::int AS n FROM publications"
  );
  send(res, 200, {
    sync: rows[0] || null,
    itemCount: countRows[0].n
  });
}

let syncing = false;

async function handleSync(res, url) {
  if (syncing) {
    send(res, 409, { error: "Sync já em andamento" });
    return;
  }
  const forceSeed = url.searchParams.get("seed") === "1";
  syncing = true;
  try {
    const result = await runSync({ forceSeed });
    send(res, 200, result);
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  } finally {
    syncing = false;
  }
}

async function handleJournals(res) {
  const { rows } = await query(`
    SELECT DISTINCT journal_id AS id, journal_name AS name
    FROM publications
    WHERE journal_id IS NOT NULL AND journal_id <> ''
    ORDER BY journal_name NULLS LAST
  `);
  send(res, 200, { items: rows });
}

async function handlePublicationAudit(id, url, res) {
  const q = url.searchParams;
  const params = new URLSearchParams();
  params.set("PublicationId", id);
  const initialDate = (q.get("initialDate") || "").trim();
  const finalDate = (q.get("finalDate") || "").trim();
  if (initialDate) params.set("InitialDate", initialDate);
  if (finalDate) params.set("FinalDate", finalDate);
  if (q.has("descending")) {
    params.set("Descending", q.get("descending") === "0" ? "false" : "true");
  } else {
    params.set("Descending", "true");
  }

  const DOE_API =
    process.env.DOE_API ||
    "https://do-api-backoffice-taxonomy.doe.sp.gov.br/v1";
  const auditUrl = `${DOE_API}/publication/audit?${params}`;

  const remote = await fetch(auditUrl, {
    headers: {
      accept: "application/json",
      origin: "https://backoffice.doe.sp.gov.br"
    }
  });
  const text = await remote.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    /* ignore */
  }
  if (!remote.ok) {
    send(res, remote.status, {
      error: (data && (data.detail || data.title)) || text || `HTTP ${remote.status}`
    });
    return;
  }

  const { rows } = await query(
    `SELECT id, title, created_at, schedule, is_immediate, status_caption,
            height, width, payment_type_name, discount_value, payload
     FROM publications WHERE id = $1`,
    [id]
  );
  const pub = rows[0] || null;
  const payload = pub
    ? typeof pub.payload === "string"
      ? JSON.parse(pub.payload)
      : pub.payload || {}
    : {};

  send(res, 200, {
    publication: pub
      ? {
          id: pub.id,
          title: pub.title,
          createdAt: pub.created_at,
          schedule: pub.schedule,
          isImmediate: pub.is_immediate,
          statusCaption: pub.status_caption,
          height: pub.height || payload.height || null,
          width: pub.width || payload.width || null,
          paymentTypeName: pub.payment_type_name || payload.paymentTypeName || null,
          discountValue:
            pub.discount_value ||
            payload.discontValue ||
            payload.discountValue ||
            null,
          journalName: payload.journalName || null,
          sectionName: payload.sectionName || payload.sectionHierarchy || null,
          sectionCode: payload.sectionCode || null,
          publicationTypeName: payload.publicationTypeName || null,
          publisherName: payload.publisherName || null
        }
      : { id },
    items: Array.isArray(data) ? data : []
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      send(res, 204, {});
      return;
    }
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/sync/status") {
      await handleSyncStatus(res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/sync") {
      await handleSync(res, url);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/publications") {
      await handlePublications(url, res);
      return;
    }
    const auditMatch = url.pathname.match(
      /^\/api\/publications\/([^/]+)\/audit$/
    );
    if (req.method === "GET" && auditMatch) {
      await handlePublicationAudit(decodeURIComponent(auditMatch[1]), url, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/journals") {
      await handleJournals(res);
      return;
    }

    if (req.method === "GET" && tryServeStatic(url.pathname, res)) {
      return;
    }

    send(res, 404, { error: "Not found" });
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`API DOE + Neon em http://localhost:${PORT}`);
  console.log(`Front: http://localhost:${PORT}/`);
  console.log("GET  /api/publications | /api/publications/:id/audit | /api/sync/status | /api/journals");
  console.log("POST /api/sync   (?seed=1 = carga inicial forçada)");
});

process.on("SIGINT", async () => {
  await getPool().end();
  process.exit(0);
});
