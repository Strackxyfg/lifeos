-- ════════════════════════════════════════════════════════════════════
-- LifeOS — Second brain v2: synapses between notes, and a real profile.
-- Idempotent: safe to run twice. Depends only on 002.
--
-- Until this runs, the app degrades instead of breaking: links are hidden
-- with a notice, and the profile falls back to the cookie it used before.
-- ════════════════════════════════════════════════════════════════════

-- ── Synapses ─────────────────────────────────────────────────────────
-- An undirected link between two notes. Stored once, smallest id first, so
-- A–B and B–A cannot both exist — the check makes the database enforce what
-- the app already does, rather than trusting every writer to remember.
create table if not exists public.lifeos_brain_links (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  from_id     uuid not null references public.lifeos_brain_items(id) on delete cascade,
  to_id       uuid not null references public.lifeos_brain_items(id) on delete cascade,
  reason      text,
  origin      text not null default 'user',
  created_at  timestamptz not null default now()
);

do $$
begin
  alter table public.lifeos_brain_links
    add constraint lifeos_brain_links_canonical check (from_id < to_id);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_brain_links
    add constraint lifeos_brain_links_origin_chk check (origin in ('user', 'suggested'));
exception when duplicate_object then null;
end $$;

create unique index if not exists lifeos_brain_links_pair_idx
  on public.lifeos_brain_links (user_key, from_id, to_id);
create index if not exists lifeos_brain_links_user_idx
  on public.lifeos_brain_links (user_key, created_at desc);
-- The cascade on delete looks links up by each end.
create index if not exists lifeos_brain_links_to_idx
  on public.lifeos_brain_links (to_id);

alter table public.lifeos_brain_links enable row level security;
drop policy if exists lifeos_brain_links_owner on public.lifeos_brain_links;
create policy lifeos_brain_links_owner on public.lifeos_brain_links
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);

-- ── Profile ──────────────────────────────────────────────────────────
-- Who the person is, as told during onboarding. Until now only a first name
-- and a job title survived, in a cookie; the other eight answers — goals,
-- current work, team size — were discarded. A second self has to know them.
create table if not exists public.lifeos_profiles (
  user_key      text primary key,
  name          text,
  profession    text,
  answers       jsonb not null default '{}'::jsonb,
  onboarded_at  timestamptz,
  updated_at    timestamptz not null default now()
);

alter table public.lifeos_profiles enable row level security;
drop policy if exists lifeos_profiles_owner on public.lifeos_profiles;
create policy lifeos_profiles_owner on public.lifeos_profiles
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);
