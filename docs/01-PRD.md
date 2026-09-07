# Product Requirements Document — LifeOS AI

**Status:** v1 · **Owner:** Product · **Last updated:** 2026-07-24

## 1. One-liner

LifeOS AI turns 10 onboarding answers into a complete, personalized Notion workspace —
databases, relations, dashboards, templates, automations, KPIs, recurring tasks, and a
personal AI assistant — in under 60 seconds.

## 2. Problem

Notion is the most flexible productivity tool in the world and, for that reason, the
hardest to start. The blank canvas is a tax. People either:

- **Bounce** — open Notion, feel overwhelmed, close it.
- **Copy templates** — end up with a graveyard of disconnected pages that don't fit them.
- **Pay consultants** — $500–$5,000 for a bespoke setup, then can't maintain it.

There is no product that *understands you* and *builds the system for you* — structure,
relations, and rituals included — then keeps it alive.

## 3. Target users

| Segment | Job to be done | Willingness to pay |
|---|---|---|
| **Founders / operators** (primary) | Run company + life from one place | High ($49–99) |
| **Freelancers / creators** | Track clients, projects, income | Medium ($19–49) |
| **Managers / leads** | Team rituals, meetings, goals | Medium–High |
| **Ambitious individuals** | Habits, goals, learning, journaling | Low–Medium ($19) |

**Beachhead:** solo founders and operators already in the Notion + AI-tools orbit.

## 4. Goals & non-goals

**Goals**
- Time-to-value < 60 seconds from finishing onboarding.
- A workspace users perceive as "built for me," not a template.
- Native Notion output (zero lock-in) so trust is high and virality is easy.
- A recurring reason to stay: weekly AI reviews and daily summaries.

**Non-goals (v1)**
- Replacing Notion's editor. We generate *into* Notion; we don't rebuild it.
- Deep project-management features (Gantt, resource leveling).
- Mobile-native apps (responsive web first).

## 5. Success metrics (North Star + inputs)

- **North Star:** Activated workspaces per week (generated **and** opened ≥ 3 days later).
- Activation rate: % of signups that complete generation (target > 70%).
- Time-to-value: p50 generation < 45s, p95 < 90s.
- Week-4 retention > 40%; free→paid conversion > 6%.
- NPS > 50 after first weekly review.

## 6. The 10 onboarding questions → generation

Answers map deterministically to a **blueprint** (which databases, which relations),
while the model personalizes copy, seed content, and assistant tone.

| # | Question | Drives |
|---|---|---|
| 1 | Name | Personalization, assistant voice |
| 2 | Profession | Module weighting, KPI selection |
| 3 | Goals (multi) | Which databases + dashboard emphasis |
| 4 | # of projects | Project DB views, grouping |
| 5 | Team size | Meeting Notes DB, collaboration, roles |
| 6 | Revenue | Finance module sizing, KPI targets |
| 7 | Uses Notion? | Build-into vs. create-for-you flow |
| 8 | Needs CRM? | CRM database |
| 9 | Needs Finance? | Finance database + runway KPI |
| 10 | Needs Learning/KM? | Knowledge Base + Reading Tracker |

**Generation produces:** workspace root → databases → relations & rollups → dashboards →
templates → automations → calendar sync → KPIs → recurring tasks → AI assistant.
(See [`05-NOTION-INTEGRATION.md`](05-NOTION-INTEGRATION.md).)

## 7. Feature set (v1 scope)

- **AI onboarding** — 10-question wizard, keyboard-first.
- **Workspace generation** — the orchestrated Notion build with live progress.
- **Integrations** — Notion (core), Google Calendar, Apple Calendar (CalDAV), Gmail, Slack, Stripe, GitHub.
- **AI layer** — weekly reviews, daily summaries, conversational + voice assistant.
- **Analytics & KPIs** — focus score, MRR, streaks, per-area rollups.
- **Team collaboration** — shared workspace, roles, invites (Founder plan).
- **Billing** — Stripe subscriptions, 14-day trial, self-serve portal.

## 8. User stories (abbreviated)

- *As a founder,* I answer 10 questions and watch a real workspace assemble, so I trust it's mine.
- *As a freelancer,* I connect Google Calendar so my planner reflects reality.
- *As an operator,* I get a Sunday review that tells me what slipped and what to do Monday.
- *As a team lead,* I invite my team and everyone shares one system.

## 9. Requirements

**Functional** — see feature set; each maps to a route in the app.
**Non-functional**
- Performance: LCP < 1.5s on marketing; TTI < 2s on app shell.
- Reliability: generation is resumable and idempotent-friendly; partial failures roll forward.
- Security: least-privilege Notion scopes; tokens encrypted at rest; RLS on all user data.
- Accessibility: WCAG 2.1 AA; full keyboard nav; reduced-motion honored.
- Privacy: no training on user content; one-click revoke + delete.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Notion API rate limits (3 req/s) | Queue + backoff; batch; show honest progress |
| Generation feels generic | Deterministic blueprint + model-personalized copy; regenerate option |
| Trust ("will it wreck my Notion?") | Build under a fresh page; native output; nothing destructive |
| Churn after novelty | Weekly review ritual + daily summary = recurring value |
| OpenAI cost | Cache; small models for summaries; batch weekly jobs |

## 11. Pricing

Starter $19 · Pro $49 (featured) · Founder $99. 14-day trial, money-back guarantee.
Rationale and packaging in [`06-STRIPE.md`](06-STRIPE.md).

## 12. Open questions

- Apple Calendar via CalDAV vs. native EventKit bridge?
- Do we host a Notion account for non-Notion users, or require signup? (v1: guided create.)
- Team billing: per-seat vs. flat Founder tier? (v1: flat, revisit at scale.)
