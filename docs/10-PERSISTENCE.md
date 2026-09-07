# Persistence — LifeOS AI

Every mutation in the app is persisted. The data layer sits behind one contract
([`lib/db/types.ts`](../lib/db/types.ts) → `Store`) with two interchangeable adapters.

## How the backend is chosen

```
NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set?
  ├─ yes → Supabase / Postgres   (lib/db/supabase-adapter.ts)
  └─ no  → local file store      (lib/db/local-adapter.ts → .data/lifeos.json)
```

Selection happens in [`lib/db/store.ts`](../lib/db/store.ts). **No component or
server action knows which backend is live** — they call the same methods either
way, so switching is purely a matter of adding env vars.

The local adapter is not a stub: it writes JSON to disk, so data survives page
reloads *and* server restarts. It exists so the app is fully functional in
development without provisioning a cloud database. It is not suitable for
serverless production (read-only filesystem) — which is exactly when Supabase
credentials would be present.

## Turning on Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run [`supabase/schema.sql`](../supabase/schema.sql) **first**,
   then [`supabase/migrations/002_workspace_data.sql`](../supabase/migrations/002_workspace_data.sql).

   Both scripts are **idempotent** — re-running them is safe, including after a
   partial failure. (The SQL editor wraps a script in a single transaction, so a
   failed run normally rolls back entirely.)

   Verify all 12 tables landed:

   ```sql
   select table_name from information_schema.tables
   where table_schema = 'public' order by table_name;
   ```

   Expected: `ai_reviews`, `integrations`, `lifeos_brain_items`, `lifeos_deals`,
   `lifeos_projects`, `lifeos_tasks`, `lifeos_transactions`, `notion_connections`,
   `profiles`, `subscriptions`, `waitlist`, `workspaces`.

3. Put these in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

4. Restart. The app now reads and writes Postgres; a first visit seeds the
   starter workspace exactly as the local store does.

To confirm which backend is live, `getStore().backend` returns `"supabase"` or
`"local"`.

## Data model

| Collection | Table | Notes |
|---|---|---|
| projects | `lifeos_projects` | status, priority, progress, due |
| deals | `lifeos_deals` | stage, value, next action |
| transactions | `lifeos_transactions` | income/expense, category |
| tasks | `lifeos_tasks` | `label_key` (i18n) **or** `label` (user text) |
| brain | `lifeos_brain_items` | `seed_key` (i18n) **or** `title` (captured) |

Seeded rows keep an i18n key instead of literal text, so the starter content
still follows the EN/FR switch. Rows the user creates carry their own text.

## Authentication

Real **Supabase Auth** when configured, demo session cookie otherwise — the same
dual-path approach as the data layer.

| Piece | File |
|---|---|
| Request-scoped client carrying the user's JWT | [`lib/supabase/rls.ts`](../lib/supabase/rls.ts) |
| Session refresh + route gate | [`middleware.ts`](../middleware.ts) |
| Sign in / sign up | [`app/actions/auth.ts`](../app/actions/auth.ts) |
| Sign out | [`app/actions/sign-out.ts`](../app/actions/sign-out.ts) |

The middleware calls `supabase.auth.getUser()` — which revalidates the token
against Supabase — rather than `getSession()`, which only decodes a cookie and
can be spoofed.

### Creating your first account

Sign up at `/signup`. Supabase enables **"Confirm email"** by default, so you'll
get a confirmation link before the session activates; the form tells you so
rather than silently failing. To skip it while developing:
**Supabase dashboard → Authentication → Providers → Email → uncheck "Confirm email"**.

### Row ownership changed with real auth

`user_key` now holds `auth.uid()` (a UUID) instead of the session email, because
that's what the RLS policies compare against. Rows seeded under the old
email key are orphaned and invisible — RLS correctly refuses them. Clear them
once, then a fresh workspace seeds on first sign-in:

```sql
delete from lifeos_projects     where user_key like '%@%';
delete from lifeos_deals        where user_key like '%@%';
delete from lifeos_transactions where user_key like '%@%';
delete from lifeos_tasks        where user_key like '%@%';
delete from lifeos_brain_items  where user_key like '%@%';
```

## Ownership and security

Every row carries `user_key` — the Supabase auth uid once real auth is wired,
the session email until then. Two layers protect it:

1. **Application scoping** — every query filters on `user_key`, and `update`
   strips `id`/`userKey`/`createdAt` from patches so a row can't be reassigned.
2. **Row-Level Security** — policies in the migration match
   `user_key = auth.uid()::text`.

✅ **RLS is now the enforcing layer.** User data goes through the request-scoped
client in `lib/supabase/rls.ts`, which carries the user's JWT, so Postgres
evaluates `user_key = auth.uid()::text` on every read and write. The
service-role client is reserved for trusted server jobs (Stripe webhooks) and is
never used for user rows.

Verified against the live project: with the anon key and no session, all five
tables return **0 rows** (service-role sees them all), inserts are rejected with
`42501`, and updates to another user's row affect nothing.

`LIFEOS_DB_ADMIN=1` forces the admin client for maintenance scripts that must
bypass RLS. Never set it in a deployed environment, and never expose the
service-role key to the client.

## Mutations

All writes go through server actions in
[`app/actions/workspace.ts`](../app/actions/workspace.ts), each Zod-validated and
returning a typed `ActionResult`. They call `revalidatePath` so server components
re-render from the database rather than trusting client state.

The UI applies optimistic updates and **reverts on failure** (task toggles, brain
items), so it stays responsive without lying about what was saved.

## Reads

[`lib/data/live.ts`](../lib/data/live.ts) loads the workspace and feeds
`computeSnapshot()` — the same snapshot the AI reasons over. So the weekly review
and daily summary describe *persisted* data: create a project and the next
review counts it.
