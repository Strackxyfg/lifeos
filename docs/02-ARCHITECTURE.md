# Architecture — LifeOS AI

Covers **Information Architecture**, **System/API architecture**, and the **file tree**.

## Information Architecture

### Site & app map

```
Public (marketing)
└─ /                     Hero · Product preview · How it works · Features
                         · Databases · Testimonials · Pricing · FAQ · Waitlist
   ├─ /#pricing  /#faq   Anchored sections (also in sitemap)
   └─ legal: /privacy /terms /security  (stubs)

Auth
├─ /login  /signup       Supabase Auth (magic link + OAuth)
└─ /onboarding           10-question wizard  → writes sessionStorage → /generate

Generation
└─ /generate             Live build experience → /dashboard

App (authenticated, (app) route group — shared sidebar/topbar/⌘K)
├─ /dashboard            Home: KPIs, projects, weekly review, today, integrations
├─ /analytics            KPIs, weekly focus chart, per-area rollups
├─ /assistant            Conversational + voice AI
├─ /team                 Members, roles, invites
├─ /billing              Plan, usage, payment method, invoices
└─ /settings             Profile, integrations, automations, danger zone
```

### Navigation model

- **Primary nav** (sidebar): Dashboard, Projects, CRM, Finance, Analytics, Assistant.
- **Secondary nav**: Team, Billing, Settings.
- **Command menu (⌘K)**: global fuzzy navigation + actions (generate, jump to any DB).
- **Keyboard**: `G D` dashboard, `G A` assistant, `⌘,` settings, `⌘K` palette.

### Content hierarchy inside Notion (generated)

```
🏠 Home (dashboard page)
├─ 📦 Projects ── relations ──► 🎯 Goals, 🗒️ Meeting Notes
├─ ✅ Tasks ─────────────────► 📦 Projects
├─ 🗓️ Weekly Planner
├─ 🔁 Habit Tracker   📓 Journal   🎯 Goal Tracker
├─ 🤝 CRM (optional)  💰 Finance (optional)
└─ 📚 Knowledge Base + 📖 Reading (optional)
```

## System architecture

```
┌────────────┐   RSC/SSR    ┌───────────────────────────┐
│  Browser   │◄────────────►│  Next.js 15 (App Router)  │
│ (React 19) │  server      │  Vercel Edge + Node        │
└────────────┘  actions     │                           │
      ▲                      │  • Marketing (static/ISR) │
      │ ⌘K, Framer Motion    │  • App (RSC + actions)    │
      │                      │  • /api route handlers    │
      │                      └───────┬───────────────────┘
      │                              │
        ┌─────────────┬──────────────┼───────────────┬─────────────┐
        ▼             ▼              ▼               ▼             ▼
   ┌─────────┐  ┌──────────┐   ┌──────────┐   ┌──────────┐  ┌──────────┐
   │Supabase │  │  Stripe  │   │ Notion   │   │  OpenAI  │  │  Upstash │
   │ Auth+PG │  │ Billing  │   │   API    │   │  (LLM)   │  │  Redis   │
   │  + RLS  │  │+webhooks │   │ (OAuth)  │   │          │  │ queue/rl │
   └─────────┘  └──────────┘   └──────────┘   └──────────┘  └──────────┘
```

**Runtime split**
- **Edge**: marketing, lightweight reads, middleware/auth gate.
- **Node**: Stripe webhooks (raw body + signature), Notion OAuth exchange, generation jobs, OpenAI calls.

**Generation as a job**
- Kicked off by a server action; long builds run via a queued worker (Upstash QStash /
  Vercel background function) so we never block a request past timeout.
- Progress is streamed to the UI (the `/generate` screen mirrors the real
  `GenerationEvent` sequence emitted by `lib/notion/generate.ts`).

## API architecture

**Principles:** typed end-to-end (Zod at every boundary), server actions for
first-party mutations, route handlers for third-party callbacks/webhooks, RLS as the
last line of defense.

### Server actions (`app/actions/*`)

| Action | Input (Zod) | Effect |
|---|---|---|
| `joinWaitlist` | `{ email, role? }` | Rate-limit → upsert `waitlist` → notify |
| `generate` | `userId, OnboardingAnswers` | Load Notion conn → `generateWorkspace` → persist manifest |
| `createCheckout` (planned) | `{ plan }` | Stripe Checkout session URL |
| `saveOnboarding` (planned) | `OnboardingAnswers` | Persist to `profiles.onboarding` |

### Route handlers (`app/api/*`)

| Route | Method | Runtime | Purpose |
|---|---|---|---|
| `/api/stripe/webhook` | POST | node | Verify signature, mirror subscription state |
| `/api/integrations/notion/callback` | GET | node | OAuth code → token → store → `/generate` |
| `/api/integrations/google/callback` | GET | node | Calendar/Gmail OAuth (planned) |
| `/api/cron/weekly-review` | POST | node | Scheduled AI reviews (planned) |

### Error & loading contract

- Every action returns a **typed result** (`{ ok: true, … } | { ok: false, error }`) — no thrown strings to the UI.
- Every route segment ships `loading.tsx` (skeletons) and `error.tsx` (recoverable).
- Empty states are first-class (see Team → pending invites, Assistant → suggestions).

## File tree

```
lifeos-ai/
├─ app/
│  ├─ layout.tsx                 Root: fonts, metadata, theme
│  ├─ globals.css                Design tokens + primitives
│  ├─ page.tsx                   Landing page
│  ├─ not-found.tsx  robots.ts  sitemap.ts
│  ├─ onboarding/page.tsx        10-question wizard
│  ├─ generate/page.tsx          Live generation
│  ├─ (app)/                     Authenticated shell (sidebar/topbar/⌘K)
│  │  ├─ layout.tsx
│  │  ├─ dashboard/page.tsx  dashboard/loading.tsx
│  │  ├─ analytics/page.tsx
│  │  ├─ assistant/page.tsx
│  │  ├─ billing/page.tsx
│  │  ├─ settings/page.tsx
│  │  └─ team/page.tsx
│  ├─ actions/                   Server actions (waitlist, generate)
│  └─ api/                       Route handlers (stripe, notion)
├─ components/
│  ├─ ui/                        button, badge, card, kbd, switch, section, reveal
│  ├─ landing/                   nav, hero, workspace-preview, logos, how-it-works,
│  │                             features, databases, testimonials, pricing, faq, waitlist, footer
│  ├─ app/                       sidebar, topbar, page-header, assistant-chat
│  ├─ onboarding/wizard.tsx
│  ├─ generation/generator.tsx
│  └─ command-menu.tsx           Raycast ⌘K palette
├─ lib/
│  ├─ utils.ts  motion.ts
│  ├─ onboarding.ts              Questions, schema, plan derivation
│  ├─ content/                   site.ts, app-nav.ts
│  ├─ notion/                    client.ts, blueprint.ts, generate.ts
│  ├─ stripe/client.ts
│  └─ supabase/                  server.ts, admin.ts
├─ supabase/schema.sql           Tables + RLS + triggers
├─ tests/                        planning.test.ts, utils.test.ts
├─ docs/                         00–09 deliverables
└─ config: next.config.mjs, tailwind.config.ts, tsconfig.json, postcss.config.mjs, vitest.config.ts
```
