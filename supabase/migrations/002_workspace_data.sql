-- ════════════════════════════════════════════════════════════════════
-- LifeOS AI — Workspace data (projects, deals, transactions, tasks, brain)
--
-- Rows are scoped by `user_key`: the Supabase auth uid once real auth is
-- wired, and the session email until then. Keeping it `text` lets both
-- identities coexist during the migration.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

create table if not exists public.lifeos_projects (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  name        text not null,
  status      text not null default 'Planning',
  owner       text not null default '',
  due         text not null default '',
  progress    integer not null default 0 check (progress between 0 and 100),
  priority    text not null default 'Medium',
  created_at  timestamptz not null default now()
);

create table if not exists public.lifeos_deals (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  name        text not null,
  company     text not null default '',
  stage       text not null default 'Lead',
  value       numeric not null default 0,
  owner       text not null default '',
  next        text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.lifeos_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  item        text not null,
  type        text not null default 'Expense',
  amount      numeric not null default 0,
  category    text not null default 'Other',
  date        text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.lifeos_tasks (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  label_key   text,             -- i18n key for seeded rows
  label       text,             -- literal text for user-created rows
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint lifeos_tasks_text_present check (label_key is not null or label is not null)
);

create table if not exists public.lifeos_brain_items (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  category    text not null default 'thoughts',
  kind        text not null default 'thought',
  seed_key    text,             -- i18n key for seeded rows
  title       text,             -- literal text for captured rows
  detail      text,
  done        boolean not null default false,
  ai          boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint lifeos_brain_text_present check (seed_key is not null or title is not null)
);

-- Every read is "this user's rows, newest first".
create index if not exists lifeos_projects_user_idx     on public.lifeos_projects (user_key, created_at desc);
create index if not exists lifeos_deals_user_idx        on public.lifeos_deals (user_key, created_at desc);
create index if not exists lifeos_transactions_user_idx on public.lifeos_transactions (user_key, created_at desc);
create index if not exists lifeos_tasks_user_idx        on public.lifeos_tasks (user_key, created_at desc);
create index if not exists lifeos_brain_items_user_idx  on public.lifeos_brain_items (user_key, created_at desc);

-- ── Row-Level Security ───────────────────────────────────────────────
-- The service-role key used by the app bypasses RLS, and the app scopes every
-- query by user_key itself. These policies are the second line of defence and
-- become the enforcing layer as soon as requests carry a Supabase Auth JWT.
alter table public.lifeos_projects     enable row level security;
alter table public.lifeos_deals        enable row level security;
alter table public.lifeos_transactions enable row level security;
alter table public.lifeos_tasks        enable row level security;
alter table public.lifeos_brain_items  enable row level security;

-- Dropped first so this migration can be re-run safely.
do $$
declare t text;
begin
  foreach t in array array[
    'lifeos_projects','lifeos_deals','lifeos_transactions','lifeos_tasks','lifeos_brain_items'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all
         using (user_key = auth.uid()::text)
         with check (user_key = auth.uid()::text)',
      t || '_owner', t
    );
  end loop;
end $$;
