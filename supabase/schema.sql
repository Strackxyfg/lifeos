-- ════════════════════════════════════════════════════════════════════
-- LifeOS AI — Supabase / Postgres schema
-- Auth is handled by Supabase Auth (auth.users). App tables live in public.
-- Row-Level Security is ON everywhere; service-role bypasses it for webhooks.
--
-- This script is IDEMPOTENT: safe to run repeatedly, and safe to re-run after
-- a partial failure. Run this first, then migrations/002_workspace_data.sql.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── Profiles ──────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  profession    text,
  onboarding    jsonb,                       -- raw 10-question answers
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Notion connections (OAuth) ────────────────────────────────────────
create table if not exists public.notion_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  workspace_id   text not null,
  workspace_name text,
  access_token   text not null,              -- encrypt at rest (pgcrypto/KMS)
  bot_id         text,
  root_page_id   text,
  created_at     timestamptz not null default now(),
  unique (user_id, workspace_id)
);

-- ── Generated workspaces (manifest of created Notion objects) ─────────
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  profile     jsonb not null,                -- answers snapshot
  manifest    jsonb not null,                -- { databases: [{key,id,url}], ... }
  status      text not null default 'ready',  -- generating | ready | failed
  created_at  timestamptz not null default now()
);

-- ── Third-party integrations (calendar, gmail, slack, github) ─────────
create table if not exists public.integrations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null,               -- google | slack | github | stripe
  access_token  text,
  refresh_token text,
  scopes        text[],
  connected_at  timestamptz not null default now(),
  unique (user_id, provider)
);

-- ── Subscriptions (mirrored from Stripe via webhooks) ─────────────────
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  plan                   text not null default 'starter',  -- starter|pro|founder
  status                 text not null default 'trialing',
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

-- ── AI reviews & summaries (weekly/daily) ─────────────────────────────
create table if not exists public.ai_reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,                 -- weekly_review | daily_summary
  content     text not null,
  metrics     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists ai_reviews_user_created_idx
  on public.ai_reviews (user_id, created_at desc);

-- ── Waitlist (public, pre-auth) ───────────────────────────────────────
create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        text,
  source      text,
  utm         jsonb,
  created_at  timestamptz not null default now()
);

-- Emails are stored lower-cased (enforced by a CHECK), so a plain UNIQUE
-- constraint on the column gives case-insensitive uniqueness *and* stays
-- compatible with PostgREST upserts (`on_conflict=email`) — which a
-- `lower(email)` expression index would not satisfy.
do $$
begin
  -- Supersedes the expression index used in an earlier revision.
  drop index if exists public.waitlist_email_lower_idx;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.waitlist'::regclass and conname = 'waitlist_email_key'
  ) then
    alter table public.waitlist add constraint waitlist_email_key unique (email);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.waitlist'::regclass and conname = 'waitlist_email_lowercase'
  ) then
    alter table public.waitlist
      add constraint waitlist_email_lowercase check (email = lower(email));
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- Row-Level Security
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles            enable row level security;
alter table public.notion_connections  enable row level security;
alter table public.workspaces          enable row level security;
alter table public.integrations        enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.ai_reviews          enable row level security;
alter table public.waitlist            enable row level security;

-- Owner-only access on all user-scoped tables.
-- Dropped first so the script can be re-run without "policy already exists".
drop policy if exists "own profile"      on public.profiles;
drop policy if exists "own notion"       on public.notion_connections;
drop policy if exists "own workspaces"   on public.workspaces;
drop policy if exists "own integrations" on public.integrations;
drop policy if exists "own subscription" on public.subscriptions;
drop policy if exists "own reviews"      on public.ai_reviews;
drop policy if exists "public can join waitlist" on public.waitlist;

create policy "own profile"      on public.profiles           for all    using (auth.uid() = id)      with check (auth.uid() = id);
create policy "own notion"       on public.notion_connections for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own workspaces"   on public.workspaces         for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own integrations" on public.integrations       for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own subscription" on public.subscriptions      for select using (auth.uid() = user_id);
create policy "own reviews"      on public.ai_reviews         for select using (auth.uid() = user_id);

-- Waitlist: anyone may insert their email, nobody may read (service-role only).
create policy "public can join waitlist" on public.waitlist for insert with check (true);

-- ── Auto-provision a profile row on signup ────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
