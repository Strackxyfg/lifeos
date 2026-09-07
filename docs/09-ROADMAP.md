# 12-Month Roadmap — LifeOS AI

Dates anchored to a **2026-07-24** start. Themes over feature-lists; each quarter has a
single narrative and a measurable outcome. Now / Next / Later discipline.

## North-star arc

> From "generates a workspace" (novelty) → "runs my week" (habit) → "runs my team" (platform).

| Quarter | Theme | Outcome |
|---|---|---|
| Q3 2026 (Jul–Sep) | **Prove the wow** | Launch; activation > 65% |
| Q4 2026 (Oct–Dec) | **Make it a habit** | W4 retention > 40%; paid > 1k |
| Q1 2027 (Jan–Mar) | **Make it a team platform** | Founder-tier ARR; net-negative churn |
| Q2 2027 (Apr–Jun) | **Make it a system of record** | Multi-surface; API/partners |

---

## Q3 2026 — Prove the wow (launch)

- **M1 (Jul):** Auth + persistence, real Notion OAuth, background generation with streamed
  progress. Close the loop: signup → generate → dashboard on live data. Private beta (design partners).
- **M2 (Aug):** Billing live (Checkout/Portal/entitlements). Google Calendar + Gmail. Daily
  summary v1. Waitlist → public beta. Polish + a11y/perf pass.
- **M3 (Sep):** **Public launch** (PH + HN). Weekly AI review v1. Template SEO hub (10 templates).
  - *Targets:* 5k signups launch week, activation > 65%, first 300 paying.

## Q4 2026 — Make it a habit (retention)

- **M4 (Oct):** Assistant v1 with retrieval + actions over the workspace. Slack + GitHub.
  Regenerate/rollback via manifest.
- **M5 (Nov):** Voice assistant. Analytics/KPIs deepened (per-area, trends). Lifecycle email
  engine. Annual plans + save-churn flows.
- **M6 (Dec):** Apple Calendar (CalDAV). Mobile web polish. Reverse-trial + pricing experiments.
  - *Targets:* W4 retention > 40%, free→paid > 6%, > 1k paying, K-factor > 0.3.

## Q1 2027 — Make it a team platform (expansion)

- **M7 (Jan):** Team workspaces, roles, invites (Founder). Shared dashboards + team review.
- **M8 (Feb):** Custom automations builder (rules over databases). Admin + audit. SSO (Google Workspace).
- **M9 (Mar):** Templates marketplace (community + curated). Creator affiliate program.
  - *Targets:* Founder-tier ARR meaningful, net-negative churn, > 3k paying.

## Q2 2027 — System of record (platform)

- **M10 (Apr):** Public API + webhooks; Zapier/Make. "LifeOS blueprints" others can publish.
- **M11 (May):** Deeper finance (bank sync via aggregator), CRM enrichment. Enterprise pilots.
- **M12 (Jun):** Native mobile companion (review + capture). SOC 2 Type I underway.
  - *Targets:* > 8k paying, > $1.5M ARR run-rate, logo-worthy design partners on record.

---

## Continuous tracks (every quarter)

- **Reliability:** generation success rate > 99%, resumability, rate-limit headroom.
- **Trust/Security:** encryption, least-privilege scopes, SOC 2 path, privacy posture.
- **Design quality:** the bar set here (Linear/Apple polish) is non-negotiable in every release.
- **Model economics:** cache + batch; keep AI COGS < 15% of revenue.

## Sequencing rationale

1. **Retention before scale.** No paid acquisition push until generated→retained is proven —
   otherwise we fill a leaky bucket.
2. **Habits before teams.** The weekly review ritual must land for individuals before the
   team story is credible.
3. **Platform last.** API/marketplace only once the core is a system of record people trust.

## Risks to the plan

- Notion API limits/changes → abstract behind our engine; keep manifest portable.
- AI cost creep → small models for summaries, batch weekly jobs, cache aggressively.
- Category noise (many "AI + Notion" tools) → differentiate on *personalization + polish + the
  60-second wow*, which are hard to copy well.
