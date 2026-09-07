# Implementation Plan — LifeOS AI

From this foundation to production. Phased, each phase shippable.

## Status legend
✅ built in this repo · 🟡 scaffolded/typed, needs live wiring · ⬜ planned

## Phase 0 — Foundation ✅ (this repo)

- ✅ Next.js 15 App Router + TS + Tailwind + Framer Motion + Geist
- ✅ Design system (tokens, primitives, motion language)
- ✅ Marketing site (hero, preview, how-it-works, features, databases, testimonials, pricing, FAQ, waitlist, footer)
- ✅ App shell (sidebar, topbar, ⌘K command menu)
- ✅ Onboarding wizard (10 Qs) · **server-streamed (SSE) generation** experience
- ✅ Dashboard, **Projects (board/table), CRM (pipeline), Finance (ledger)**, analytics, assistant, billing, settings, team
- ✅ **Auth pages** (/login, /signup) + **session-cookie gate via middleware** + sign-out · **working ⌘K + G-chord shortcuts** · **error boundaries**
- ✅ **Mobile nav drawer** + **light/dark theme toggle** (no-FOUC)
- ✅ Notion engine (client, blueprints, orchestrator) — typed
- ✅ Stripe (lazy client, checkout, portal, webhook handler)
- ✅ Supabase schema + RLS · server actions · unit tests
- ✅ **Verified: `next build`, `tsc`, and `vitest` all green**

## Phase 1 — Auth & persistence (Week 1–2)

- ✅ Middleware auth-gate on `(app)/*`; redirect unauth → `/login` (session cookie, sign-out)
- 🟡 Swap demo session for Supabase Auth (magic link + Google OAuth) via `@supabase/ssr`
- ✅ Personalized shell — onboarding writes a profile cookie; dashboard/sidebar/topbar/settings/assistant read `getProfile()` (name derived from email as fallback)
- ✅ Settings **writes back** — `updateProfile` server action persists name/profession; `router.refresh()` updates the sidebar + greeting live, with a toast
- ✅ Interactive surfaces — toggleable Today tasks (live count), reusable event-based `Toaster`
- ✅ **Second Brain** — interactive 3D neural brain (React Three Fiber / three.js), rotatable, with Ideas / Thoughts / Next steps / Knowledge / Insights as clickable regions, AI "what to do next", and a capture bar
- ✅ **Bilingual EN/FR** — cookie-based locale, typed dictionaries, `LanguageSwitch` in topbar + auth; parity enforced by unit tests
- ✅ **Real AI wired** — Groq / Cerebras (OpenAI-compatible) via `AI_PROVIDER`; streaming assistant (`/api/assistant`), Second-Brain classification (`/api/brain/capture`), and **weekly review + daily summary** (`/api/insights`) — all locale-aware with a graceful no-key fallback
- ✅ **AI reasons over real data** — `buildSnapshot()` computes project/finance/CRM/task aggregates and feeds them to the model, so reviews cite true figures; the no-key fallback is derived from the same snapshot and stays factually correct
- ✅ **Functional UI sweep** — Settings toggles persist (cookie-backed server action), notification bell is a real data-derived alert panel, status/stage/priority enums localized, dashboard cards link through
- 🟡 Persist onboarding + settings to Supabase `profiles` (currently a signed cookie)
- ⬜ Account settings write-through; profile edit server action

## Phase 2 — Real generation (Week 2–4)

- 🟡 Notion OAuth end-to-end (callback exists) → store encrypted token
- 🟡 Move generation to a **background job** (Upstash QStash) with rate-limit + backoff
- 🟡 Stream real `GenerationEvent`s to `/generate` (SSE/websocket) — UI already models them
- ⬜ Manifest-based resume/rollback; `workspaces.status` transitions
- ⬜ Dashboards/rollups/formulas written via API; recurring-task seeding

## Phase 3 — Billing & entitlements (Week 4–5)

- 🟡 Checkout + Portal from `/billing`; webhook already mirrors state
- ⬜ Plan gating middleware (workspaces, generations/mo, features)
- ⬜ Usage metering surfaced in `/billing`

## Phase 4 — Integrations (Week 5–8)

- ⬜ Google Calendar + Gmail OAuth → planner + daily summary
- ⬜ Apple Calendar (CalDAV) · Slack · GitHub
- ⬜ Integration health + reconnect flows (UI states already present)

## Phase 5 — AI layer (Week 6–9)

- ⬜ Weekly review + daily summary jobs (OpenAI) → `ai_reviews` + Notion page
- ⬜ Assistant retrieval over the user's workspace (function-calling to Notion)
- ⬜ Voice (Web Speech API in, TTS out); the assistant UI already has the mic affordance

## Phase 6 — Team & polish (Week 9–12)

- ⬜ Team invites, roles, shared workspace (Founder plan)
- ⬜ Empty/skeleton coverage audit, a11y pass (AA), perf budget (LCP < 1.5s)
- ⬜ Playwright e2e for onboarding → generation → dashboard

## Engineering standards

- **Typed boundaries** — Zod at every action/route; typed action results (no thrown strings to UI).
- **Feature folders** — `components/{landing,app,onboarding,generation}`, `lib/{notion,stripe,supabase}`.
- **Server-first** — RSC by default; `"use client"` only where interaction requires it (a real
  RSC/`motion` boundary bug was caught and fixed via the `RevealItem` pattern).
- **Edge vs Node** — Node only where required (Stripe signature, Notion OAuth); rest edge-friendly.
- **Testing** — unit (Vitest) on deterministic core (planning/blueprints/utils); e2e later.
- **CI** — `typecheck && lint && test && build` on every PR; preview deploys on Vercel.
