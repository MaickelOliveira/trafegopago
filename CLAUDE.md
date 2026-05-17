# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # dev server (auto-selects port if 3000 is taken)
npm run build    # production build + TypeScript check
npm run lint     # eslint
npm start        # run production build
```

After changing `next.config.ts` or `src/proxy.ts`, restart the dev server manually. Clear stale fetch cache:
```bash
rm -rf .next/cache/fetch-cache
```

## Critical: Next.js 16.2.4 Breaking Changes

- **Proxy not middleware** — `src/proxy.ts` must export `async function proxy(request)`, not `middleware`
- **Async params** — route handlers always `await params`: `{ params }: { params: Promise<{ id: string }> }`
- When in doubt about an API, read `node_modules/next/dist/docs/`

## Architecture

### Auth

Two roles: `manager` and `client`. JWT in `tp_session` httpOnly cookie (7d). `src/proxy.ts` enforces `/gestor/*` → manager, `/cliente/*` → client. Helpers in `src/lib/auth.ts`.

### File-based storage (no database)

All data is JSON files in `data/`:

| File | Contents |
|------|----------|
| `config.json` | Manager credentials + `metaToken`, `uazapiServer/Token`, `anthropicApiKey`, `appBaseUrl`, `uazapiWebhookForward` |
| `clients.json` | Array of clients with `id`, `adAccounts[]`, `funnelType`, `tintimCode/Token/WebhookForward` |
| `leads.json` | CRM leads with `funnelId`, `clientId`, `status`, `source`, `ai` |
| `funnels.json` | Kanban funnel definitions with custom `columns[]` |
| `financeiro.json` | Financial transactions (receita/despesa) |
| `sales.json` | Tintim sales with UTM attribution |
| `conversations.json` | WhatsApp AI agent conversation history |

Read via `src/lib/clients.ts` — server-side only, never import in client components. Types that need to be shared with client components go in separate `*-types.ts` files (e.g., `sales-types.ts`, `financeiro-types.ts`) to avoid `fs` module errors in the browser bundle.

### Client folder convention

Per-client brand assets and creatives live **outside** the project at:
```
/Claude Code/clientes/{clientName}/
  marca.json       — brand identity (colors, promptBase, referencias)
  criativos/       — generated image files
```
The `src/app/api/social/generate/route.ts` reads `../clientes/{clientId}/marca.json` (tries exact ID, then first segment before `-`).

### Meta API

`src/lib/meta-api.ts` wraps Graph API v19.0. All calls go through Next.js API routes — browser never calls Meta directly. Budget values are in BRL; the API route multiplies ×100 before sending (Meta expects centavos).

**Image handling:** Use plain `<img>` (never `next/image`) for Meta/Instagram CDN URLs. `thumbnail_url` expires — use `effective_instagram_media_id` → `/api/meta/ig/[mediaId]` for stable URLs.

### Image Generation

Two backends, auto-selected:
- **Google Imagen 4 Ultra** (`src/lib/imagen.ts`) — used when `GOOGLE_IMAGEN_API_KEY` is set. Returns `Buffer` from base64. **Preferred.**
- **Nano Banana** (`src/lib/nanobanana.ts`) — async task-polling fallback (`createTask` → `pollTask`).

Generated images are saved to `/Claude Code/clientes/{client}/criativos/` and served via `/api/social/imagem/[...filepath]` (files are outside `public/`).

### Tintim (WhatsApp sales tracking)

Each client has their own `tintimCode` + `tintimToken` stored in `clients.json`. Webhook URL per client: `/api/tintim/webhook?clientId={id}`. The webhook detects sale events by keyword matching (`SALE_KEYWORDS` in `webhook/route.ts`), fetches lead data from Tintim API to get UTMs, then saves to `data/sales.json`. If `tintimWebhookForward` is set, the payload is forwarded (fire-and-forget) before processing.

### CRM

Leads have a `funnelId` linking to `data/funnels.json`. Status is a free-form string matching a column `id` in that funnel (not a fixed enum). Multiple funnels are supported. WhatsApp messages auto-create leads via `upsertLeadByPhone` in the WhatsApp webhook handler.

### Financeiro

Transactions split into `receita`/`despesa`. Types and constants shared with client components are in `src/lib/financeiro-types.ts`. Server-only CRUD in `src/lib/financeiro.ts`.

### Social Media / Creatives

`/api/social/generate` — Claude generates caption + image prompt, then calls Imagen/Nanobanana, saves the PNG to the client folder, returns internal URL `/api/social/imagem/...`. Brand identity from `marca.json` is injected into both the Claude prompt and the image prompt.

### Route Map (additions since base CLAUDE.md)

```
/gestor/crm                          Global CRM Kanban (all clients)
/gestor/financeiro                   Agency P&L dashboard
/gestor/financeiro/receitas          Calendar view — income only
/gestor/financeiro/despesas          Calendar view — expenses only
/gestor/social                       Social media creative generator
/gestor/[clientId]/dashboard         Visual charts dashboard per client

/api/tintim/webhook                  Receives Tintim events, creates sales
/api/tintim/sales                    Aggregated sales stats by campaign
/api/tintim/sync                     Bulk-query Tintim by phone list
/api/crm/leads                       CRUD for CRM leads
/api/crm/funnels                     CRUD for funnel definitions
/api/crm/whatsapp/status             UazAPI connection + QR code
/api/crm/whatsapp/sync               Import contacts from UazAPI
/api/social/generate                 Generate caption + image with AI
/api/social/criativos                List saved creatives for a client
/api/social/imagem/[...filepath]     Serve images from clientes/ folder
/api/financeiro                      GET (month summary) + POST transaction
/api/financeiro/[id]                 PUT/DELETE transaction
```

### Deployment (EasyPanel)

- `Dockerfile` uses Next.js standalone output (`output: "standalone"` in `next.config.ts`)
- Mount a persistent volume at `/app/data` to preserve all JSON data across restarts
- Set `GOOGLE_IMAGEN_API_KEY`, `NANOBANANA_API_KEY`, `TINTIM_*` etc. as EasyPanel environment variables
- After deploy, configure UazAPI webhook to `https://{domain}/api/whatsapp/webhook` — the handler auto-forwards to `config.uazapiWebhookForward` (the previous n8n URL)
