/**
 * Worker de sincronização DOE → Neon.
 * - Complemento incremental a cada 60s (padrão)
 * - Reconcile dos últimos N dias periodicamente (status + buracos)
 * - Carga inicial (5 dias) uma vez, se necessário
 *
 * Uso: npm run worker
 */
import { loadEnv } from "./lib/env.js";
import { getPool, query } from "./lib/db.js";
import { runSync } from "./sync.js";

loadEnv();

const INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 60 * 1000);
/** Reconcile da janela recente (padrão: a cada 3 min). */
const RECONCILE_EVERY_MS = Number(process.env.RECONCILE_TODAY_MS || 3 * 60 * 1000);
const RECONCILE_DAYS = Math.max(
  1,
  Number(process.env.DOE_RECONCILE_DAYS || 3)
);
let busy = false;
/** 0 = forçar reconcile no primeiro ciclo após a semente. */
let lastReconcileAt = 0;

function ts() {
  return new Date().toLocaleString("pt-BR");
}

async function needsSeed() {
  const { rows } = await query(
    "SELECT seeded_at, max_created_at FROM sync_state WHERE id = 'default'"
  );
  const s = rows[0];
  return !(s && s.seeded_at && s.max_created_at);
}

function logResult(label, result) {
  console.log(
    `[${ts()}] OK (${result.mode}${label ? " / " + label : ""}): +${result.upserted}` +
      (result.purged ? ` · -${result.purged} antigas` : "") +
      ` · total Neon: ${result.itemCount}` +
      (result.maxCreatedAt ? ` · max createdAt: ${result.maxCreatedAt}` : "")
  );
}

async function tick() {
  if (busy) {
    console.log(`[${ts()}] Sync anterior ainda em andamento — pulando ciclo.`);
    return;
  }
  busy = true;
  try {
    const seed = await needsSeed();
    if (seed) {
      console.log(`[${ts()}] Iniciando carga inicial (5 dias)…`);
      const result = await runSync({ forceSeed: true });
      logResult("seed", result);
      lastReconcileAt = Date.now();
      return;
    }

    console.log(`[${ts()}] Iniciando complemento…`);
    const incremental = await runSync({ forceSeed: false });
    logResult(null, incremental);

    const due = Date.now() - lastReconcileAt >= RECONCILE_EVERY_MS;
    if (due) {
      console.log(`[${ts()}] Iniciando reconcile (${RECONCILE_DAYS}d)…`);
      const reconciled = await runSync({ reconcileToday: true });
      logResult("reconcile", reconciled);
      lastReconcileAt = Date.now();
    }
  } catch (err) {
    console.error(`[${ts()}] Erro no sync:`, err.message || err);
  } finally {
    busy = false;
  }
}

async function main() {
  console.log(`Worker DOE→Neon`);
  console.log(`Intervalo complemento: ${INTERVAL_MS / 1000}s`);
  console.log(
    `Reconcile ${RECONCILE_DAYS}d: a cada ${RECONCILE_EVERY_MS / 1000}s`
  );
  console.log(`Retenção: ${process.env.DOE_RETENTION_DAYS || 10} dias (created_at)`);
  console.log(`Início: ${ts()}`);
  console.log("-".repeat(40));

  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch(async (err) => {
  console.error("Worker falhou ao iniciar:", err.message || err);
  try {
    await getPool().end();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});

process.on("SIGINT", async () => {
  console.log("\nEncerrando worker…");
  try {
    await getPool().end();
  } catch (_) {
    /* ignore */
  }
  process.exit(0);
});
