# Notion API Implementation — LifeOS AI

## Getting it running

Generation runs in one of two modes, resolved by
[`lib/notion/connection.ts`](../lib/notion/connection.ts):

| Mode | When | What happens |
|---|---|---|
| **live** | Notion credentials present | Databases, relations and dashboards are really created in Notion |
| **simulated** | No credentials | The same phases play out, clearly labelled *"Preview only — nothing is being created"* |

The `/generate` screen states which mode it is, and the API sets an
`X-Generation-Mode` header — the product never pretends a build happened.

### Option A — Internal integration (fastest, your own workspace)

1. Go to <https://www.notion.so/my-integrations> → **New integration** → type **Internal**.
2. Copy the **Internal Integration Secret** → `NOTION_TOKEN` in `.env.local`.
3. Open (or create) the Notion page LifeOS should build inside.
4. On that page: **•••** (top-right) → **Connections** → **Connect to** → pick your integration.
   *Without this step the API returns 404 — the token can only see pages explicitly shared with it.*
5. Copy the page URL → `NOTION_ROOT_PAGE_ID` (a full URL is fine; it's normalized).
6. Restart the dev server and run onboarding again.

### Option B — Public OAuth (multi-user, ships to customers)

1. Same page → **New integration** → type **Public**.
2. Fill in the OAuth details; set the redirect URI to
   `http://localhost:3000/api/integrations/notion/callback`.
3. Set `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `NOTION_REDIRECT_URI`.
4. Run [`supabase/migrations/003_notion_oauth.sql`](../supabase/migrations/003_notion_oauth.sql)
   — it adds the `user_key` column the connection is stored under.
5. In the app: **Settings → Integrations → Notion → Connect Notion**, approve on
   Notion's screen, and **pick at least one page to share**.

A per-user OAuth token always takes precedence over `NOTION_TOKEN`.

#### Flow

```
Settings → GET /api/integrations/notion/authorize
             mints `state`, stores it httpOnly, redirects to Notion consent
        → user approves and selects pages
        → GET /api/integrations/notion/callback?code=…&state=…
             verify state (CSRF) → exchange code for token
             → resolve root page (duplicated_template_id, else /v1/search)
             → upsert into notion_connections (scoped by user_key)
        → /settings?notion=connected
```

Every failure redirects with a specific reason — `denied`, `no_code`,
`bad_state`, `bad_credentials`, `exchange_failed`, `no_page_shared`,
`store_failed` — surfaced as a toast instead of failing silently.

**CSRF:** the `state` is single-use, httpOnly, `SameSite=lax`, 10-minute TTL.
Without it an attacker could hand a signed-in user a pre-baked callback URL and
bind their own Notion workspace to the victim's account.

---


Code: [`../lib/notion/client.ts`](../lib/notion/client.ts) ·
[`../lib/notion/blueprint.ts`](../lib/notion/blueprint.ts) ·
[`../lib/notion/generate.ts`](../lib/notion/generate.ts) ·
callback [`../app/api/integrations/notion/callback/route.ts`](../app/api/integrations/notion/callback/route.ts).

## Design goals

- **No SDK dependency** — a thin, typed `fetch` wrapper keeps us edge-friendly and lean.
- **Deterministic core, AI at the edges** — the *structure* comes from blueprints (testable,
  reproducible); the model only personalizes copy and seed content.
- **Idempotency-friendly** — every created object id is stored in the workspace `manifest`,
  so we can resume, revoke, or regenerate without orphaning pages.

## 1. OAuth (public integration)

```
User → “Connect Notion” → Notion consent (user picks a page)
     → /api/integrations/notion/callback?code=…
     → POST https://api.notion.com/v1/oauth/token  (Basic client:secret)
     → { access_token, workspace_id, workspace_name, duplicated_template_id, bot_id }
     → encrypt + upsert into notion_connections
     → redirect /generate
```

Scopes requested are minimal: content read/write on the page the user grants. The user
always chooses the parent page — we never see their whole workspace.

## 2. Client (`NotionClient`)

Typed methods over the REST API (`2022-06-28`):

| Method | Endpoint |
|---|---|
| `me()` | `GET /users/me` (token check) |
| `createDatabase()` | `POST /databases` |
| `createPage()` | `POST /pages` (also DB rows) |
| `addRelation()` | `PATCH /databases/{id}` |

Errors are normalized to a `NotionError { status, code }` so callers can branch on
rate-limits (`429`) vs. auth (`401`) vs. validation.

## 3. Blueprints

`blueprint.ts` declares each database's `properties` (typed `NotionPropertySchema`),
`relations` (by target key), and optional `seed` rows. `selectBlueprints(answers)` resolves
the exact set for a user — this is unit-tested in [`../tests/planning.test.ts`](../tests/planning.test.ts).

Property types supported: `title, rich_text, number(format), select, multi_select, status,
checkbox, date, url, email, people, relation`.

## 4. Generation orchestration (`generateWorkspace`)

Ordered, progress-emitting build:

```
verify → databases (pass 1: no relations)
       → relations (pass 2: PATCH in relation props)
       → dashboards (Home page + linked views)
       → templates → automations
       → seed (welcome rows) → assistant → done
```

Each phase emits a `GenerationEvent { step, label, progress }`. The `/generate` screen
mirrors this exact sequence, so the animation reflects real work (and can be swapped to a
websocket/stream of live events with no UI change).

### Why two passes

A Notion `relation` property requires the **target database to already exist**. So we
create all databases first, record their ids, then PATCH in the relation properties. This
also lets a partial failure roll forward: re-running skips ids already in the manifest.

## 5. Rate limits & reliability

- Notion allows ~3 requests/second. The production build runs through a **queue** (Upstash
  QStash) with token-bucket limiting and exponential backoff on `429`.
- Long builds execute as a **background job**, not inside a request, so we never hit
  serverless timeouts. Progress streams to the client.
- Every write is logged to the `manifest`; a `workspaces.status` of `generating|ready|failed`
  drives resumability and the UI.

## 6. Automations, KPIs, recurring tasks

- **Automations/KPIs** are expressed as Notion **rollups + formulas** wired during pass 2
  (e.g. Project Progress = % linked Tasks done). Where Notion can't express it, a scheduled
  job (`/api/cron/*`) updates values.
- **Recurring tasks** (daily standup, weekly review) are seeded as template rows plus a cron
  that re-instantiates them and writes the AI review into `ai_reviews` + a Notion page.

## 7. Privacy

Tokens encrypted at rest; least-privilege scopes; no model training on user content; revoke
disconnects and (optionally) deletes LifeOS-created pages via the stored manifest — the
user's own pages are never touched.
