# Database Schema — LifeOS AI

Two schemas: (1) **LifeOS app data** in Supabase/Postgres, and (2) the **generated Notion
databases** the product writes into the user's Notion.

## 1. App data — Supabase / Postgres

Full DDL with RLS + triggers: [`../supabase/schema.sql`](../supabase/schema.sql).

### Entity overview

```
auth.users (Supabase Auth)
   │ 1:1
   ├─ profiles              onboarding answers, name, profession
   │ 1:N
   ├─ notion_connections    OAuth token, workspace, root page
   ├─ workspaces            generation manifest + profile snapshot
   ├─ integrations          google/slack/github/stripe tokens
   ├─ ai_reviews            weekly reviews & daily summaries
   └─ subscriptions (1:1)   mirrored Stripe state

waitlist                    pre-auth email capture (public insert, service-role read)
```

### Table notes

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id → auth.users`, `onboarding jsonb` | Auto-created by `handle_new_user` trigger on signup |
| `notion_connections` | `access_token`, `root_page_id` | **Encrypt** token at rest (pgcrypto/KMS). Unique per (user, workspace) |
| `workspaces` | `manifest jsonb`, `status` | Manifest = every DB id/url created, for idempotency + revoke |
| `integrations` | `provider`, tokens, `scopes[]` | One row per provider per user |
| `subscriptions` | `plan`, `status`, `current_period_end` | Source of truth is Stripe; this is a read-mirror |
| `ai_reviews` | `kind`, `content`, `metrics jsonb` | Indexed `(user_id, created_at desc)` |
| `waitlist` | `email text unique` + `check (email = lower(email))`, `utm jsonb` | Insert-only for anon; read via service-role. Lower-cased storage gives case-insensitive uniqueness without `citext`, and keeps PostgREST `on_conflict=email` upserts working |

### Security model

- **RLS ON for every table.** Owner-only policies keyed on `auth.uid()`.
- `subscriptions` and `ai_reviews` are **select-only** to the user (writes come from server/webhooks via service-role, which bypasses RLS).
- `waitlist` allows anonymous `insert` with `check (true)` but no `select` — emails are never publicly readable.
- Tokens are stored encrypted; service-role key is server-only (`lib/supabase/admin.ts`), never shipped to the client.

## 2. Generated Notion databases

Defined as typed **blueprints** in [`../lib/notion/blueprint.ts`](../lib/notion/blueprint.ts).
Each blueprint = `{ properties, relations, seed }`. Relations are wired in a second pass
(a relation needs its target DB to exist first).

| Database | Core properties | Relations |
|---|---|---|
| Projects | Name, Status, Priority, Due, Progress% | → Goals, → Meeting Notes |
| Tasks | Name, Status, Do date, Effort | → Projects |
| Goal Tracker | Name, Horizon, Progress%, Status | (target of Projects) |
| Weekly Planner | Week, Start, Focus, Reflection | — |
| Habit Tracker | Habit, Cadence, Done, Streak | — |
| Journal | Entry, Date, Mood | — |
| CRM* | Name, Company, Stage, Value$, Email, Next | — |
| Finance* | Item, Type, Amount$, Category, Date | — |
| Knowledge Base* | Title, Type, Tags | — |
| Reading Tracker* | Title, Author, Status, Rating | — |
| Meeting Notes† | Title, Date, Decisions | → Projects |

\* included when the user opts in (CRM / Finance / Learning).
† included for teams or when "Team & meetings" is a goal.

### Relation graph (rollups)

```
Tasks ──"Project"──► Projects ──"Goals"──► Goal Tracker
                          └──"Meetings"──► Meeting Notes
```

Rollups computed on top: Project **Progress** = % of linked Tasks done; Goal **Progress**
= weighted rollup of linked Projects. These power the dashboard KPIs.
