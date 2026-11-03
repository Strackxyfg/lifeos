-- ════════════════════════════════════════════════════════════════════
-- LifeOS — Specialists: the sub-agents a person defines for their needs.
-- Idempotent; depends only on auth.
--
--   · lifeos_specialists — one row per specialist: its name, and in `data`
--     its description, instructions, tools and depth (lib/specialists/model.ts)
--
-- The database keeps what must hold whoever writes:
--   · each person reads and writes only their own rows (RLS);
--   · a name is unique per person, whatever its case;
--   · at most 30 per person — counted under a per-person lock, so two
--     inserts at the same moment cannot both pass.
-- Until this runs, the specialists page says it needs it; nothing else changes.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.lifeos_specialists (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  name        text not null check (char_length(name) between 1 and 40),
  data        jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 32768),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists lifeos_specialists_name_idx on public.lifeos_specialists (user_key, lower(name));

alter table public.lifeos_specialists enable row level security;

drop policy if exists lifeos_specialists_owner on public.lifeos_specialists;
create policy lifeos_specialists_owner on public.lifeos_specialists
  for all using (user_key = auth.uid()::text) with check (user_key = auth.uid()::text);

-- ── At most 30 per person ─────────────────────────────────────────
create or replace function public.lifeos_specialists_cap() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('lifeos_specialists:' || new.user_key));
  if (select count(*) from public.lifeos_specialists where user_key = new.user_key) >= 30 then
    raise exception 'specialists_full' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists lifeos_specialists_cap on public.lifeos_specialists;
create trigger lifeos_specialists_cap
  before insert on public.lifeos_specialists
  for each row execute function public.lifeos_specialists_cap();
