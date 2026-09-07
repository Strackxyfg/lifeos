<div align="center">

# LifeOS AI

**Your entire life, organized in 60 seconds.**

LifeOS AI generates a complete, personalized Notion workspace — databases, dashboards,
automations, and an AI assistant — from 10 onboarding questions, in under a minute.

</div>

---

## What this repository is

A production-grade foundation for LifeOS AI: a runnable Next.js application (premium
landing page + full app shell + live generation engine) **and** the full product/strategy
documentation a studio would hand over.

- **Runnable code** — landing page, onboarding, generation, dashboard, assistant, billing, settings, team.
- **Real integration layer** — typed Notion generation engine, Stripe billing, Supabase schema, server actions, API routes.
- **17 deliverables** — see [`docs/`](docs/00-INDEX.md).

## Quickstart

```bash
npm install
cp .env.example .env.local   # fill in keys (optional for the marketing site)
npm run dev                  # http://localhost:3000
```

Nothing to configure to *see* the product: the landing page, onboarding wizard, generation
animation, and dashboard all run with zero keys. Add keys to enable real Notion/Stripe/Supabase.

```bash
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run test        # vitest
```

### Routes

| Route | What it is |
|---|---|
| `/` | Premium marketing site (hero, product preview, pricing, FAQ, waitlist) |
| `/onboarding` | 10-question wizard (keyboard-driven, Linear-grade) |
| `/generate` | Live workspace-generation experience |
| `/dashboard` | The operating dashboard (KPIs, projects, weekly review) |
| `/assistant` | Conversational + voice AI assistant |
| `/analytics` · `/billing` · `/settings` · `/team` | Full app surfaces |

Press <kbd>⌘K</kbd> anywhere for the Raycast-style command menu.

## Tech stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS · Framer Motion · Geist ·
Supabase/Postgres · Stripe · OpenAI · Notion API · Vercel · Upstash Redis.

## Structure

```
app/            Routes: marketing, (app) group, api, server actions
components/      ui/ primitives · landing/ · app/ · onboarding/ · generation/
lib/            design tokens, motion, notion/ engine, stripe/, supabase/, content/
supabase/       schema.sql (tables + RLS)
docs/           17 deliverables (PRD → 12-month roadmap)
tests/          Vitest unit tests
```

## Design system in one breath

Graphite canvas · porcelain ink · one restrained accent · hairline borders · 8px grid ·
Geist type · soft shadows only · motion limited to opacity/translateY/scale at 150–500ms.
No purple, no neon, no generic cards. See [`docs/04-DESIGN-SYSTEM.md`](docs/04-DESIGN-SYSTEM.md).

## Deliverables

Full index: [`docs/00-INDEX.md`](docs/00-INDEX.md). PRD, IA, DB schema, UI/UX specs,
design system, file tree, implementation plan, API architecture, Notion + Stripe +
Supabase implementations, landing page, dashboard, growth, SEO, launch, and a 12-month roadmap.

---

<div align="center"><sub>Native Notion. No lock-in. You own everything.</sub></div>
