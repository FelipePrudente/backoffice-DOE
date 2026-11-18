# Deploy piloto — Render (API) + GitHub Actions (sync)

## Arquitetura
- **Render Web Service (free):** `npm start` → API + front
- **GitHub Actions:** incremental DOE → Neon a cada ~10 min; **reconcile dos últimos 3 dias só após 20:00 BRT**. Manual a qualquer hora.
- **Não usa** Background Worker pago do Render

## 1) GitHub (repo pessoal, privado)
1. Envie o código **sem** `.env.local`.
2. Confira se existe `.github/workflows/sync.yml`.

## 2) Secrets do GitHub (sync)
No repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Obrigatório | Valor |
|--------|-------------|--------|
| `DATABASE_URL` | sim | do `.env.local` |
| `DATABASE_URL_UNPOOLED` | se existir no `.env.local` | mesma ideia |
| `DOE_ALLOW_INSECURE_TLS` | opcional | comece com `false`; se o sync falhar por TLS, use `true` |
| `TEAMS_WEBHOOK_URL` | p/ relatório imediatas | URL do Power Automate (canal operação) |

## 3) Testar o Actions
1. Aba **Actions** → workflow **Sync DOE Neon**
2. **Run workflow** → mode `both`
3. Veja se o job fica verde (Neon atualiza)

Os crons automáticos só rodam com o workflow no branch default (`main`/`master`) e Actions habilitado.

## 4) Render — só Web Service
1. **New → Web Service** (não precisa de Worker)
2. Repo pessoal
3. Build: `npm install` · Start: `npm start` · Health: `/api/health`
4. Env vars no Render:

| Key | Valor |
|-----|--------|
| `DATABASE_URL` | do Neon |
| `DATABASE_URL_UNPOOLED` | se usar |
| `DOE_ALLOW_INSECURE_TLS` | `false` (ou `true` se necessário) |
| `DOE_LOOKBACK_DAYS` | `5` |
| `DOE_RECONCILE_DAYS` | `3` (só no Actions/worker) |
| `DOE_RETENTION_DAYS` | `10` |

5. Deploy → teste:
   - `https://SEU-APP.onrender.com/api/health`
   - `https://SEU-APP.onrender.com/`

## 5) Time
Envie o link do Render. O sync continua pelo Actions, mesmo com seu PC desligado.

## Atenções
- **Render free:** o site pode “dormir”; 1ª abertura fica lenta.
- **Actions cron:** no free pode atrasar alguns minutos (não é exato como 60s locais).
- Se a **API DOE** bloquear IPs da nuvem (GitHub/Render), o sync falha — aí o sync precisa rodar na rede Prodesp (`npm run worker` local).

## 6) Relatório Imediatas → Teams
1. Secret `TEAMS_WEBHOOK_URL` (URL do Power Automate do canal)
2. Workflow **Relatório Imediatas Teams** (a cada 2h + manual)
3. Recorte: `createdAt` = hoje e `isImmediate` = true
4. Local: `npm run report:imediatas` (ou `-- --dry-run`)

## Local
```bash
npm start           # http://localhost:3847
npm run worker      # opcional, se quiser sync local também
npm run report:imediatas
```
