-- ════════════════════════════════════════════════════════════════════
-- LifeOS AI — Notion OAuth connections
--
-- The original `notion_connections` table keyed rows on `user_id uuid`
-- referencing auth.users. The app scopes everything by `user_key` (the auth
-- uid as text, or the session email before real auth), so add that column and
-- relax the uuid FK. Idempotent.
-- ════════════════════════════════════════════════════════════════════

alter table public.notion_connections
  add column if not exists user_key text;

-- Backfill from the old column where present, then make it required.
update public.notion_connections
   set user_key = user_id::text
 where user_key is null and user_id is not null;

alter table public.notion_connections
  alter column user_id drop not null;

create unique index if not exists notion_connections_user_key_idx
  on public.notion_connections (user_key);

create index if not exists notion_connections_lookup_idx
  on public.notion_connections (user_key, created_at desc);

alter table public.notion_connections enable row level security;

drop policy if exists "own notion" on public.notion_connections;
drop policy if exists notion_connections_owner on public.notion_connections;

create policy notion_connections_owner on public.notion_connections
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);
