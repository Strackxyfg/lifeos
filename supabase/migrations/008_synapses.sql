-- ════════════════════════════════════════════════════════════════════
-- LifeOS — Synapses: connections that mean something.
-- Idempotent: safe to run twice. Depends on 007.
--
-- Until this runs, the app degrades instead of breaking: every connection is
-- a plain "related" one, notes are not analysed for concepts, and a
-- connection you remove may be proposed again.
-- ════════════════════════════════════════════════════════════════════

-- ── What a connection is ─────────────────────────────────────────────
-- A connection now says what kind of relation it is, and which way it points
-- when the relation has a direction ("A advances B" is not "B advances A").
-- The pair itself stays canonical (from_id < to_id, see 007); the direction
-- lives in source_id, which must be one of the two ends.
alter table public.lifeos_brain_links add column if not exists kind text not null default 'related';
alter table public.lifeos_brain_links add column if not exists source_id uuid;

do $$
begin
  alter table public.lifeos_brain_links
    add constraint lifeos_brain_links_kind_chk
    check (kind in ('advances', 'supports', 'extends', 'tension', 'related'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_brain_links
    add constraint lifeos_brain_links_source_chk
    check (source_id is null or source_id = from_id or source_id = to_id);
exception when duplicate_object then null;
end $$;

-- Who drew it. 'ai' (the connection engine) and 'agent' (an MCP client such
-- as Hermes) mark connections the person has not reviewed yet; keeping one
-- turns it into 'suggested' — proposed by LifeOS, accepted by the person.
alter table public.lifeos_brain_links drop constraint if exists lifeos_brain_links_origin_chk;
alter table public.lifeos_brain_links
  add constraint lifeos_brain_links_origin_chk
  check (origin in ('user', 'suggested', 'ai', 'agent'));

-- ── What a note is about ─────────────────────────────────────────────
-- Concepts extracted from a note: [{ "k": canonical English key, "l": label
-- in the note's own language }]. The key is what lets a French note about
-- "parrainage" meet an English one about "referral". concepts_hash records
-- the text they were extracted from, so an edited note is analysed again and
-- an unchanged one never is.
alter table public.lifeos_brain_items add column if not exists concepts jsonb not null default '[]'::jsonb;
alter table public.lifeos_brain_items add column if not exists concepts_hash text;

-- ── What the person said no to ───────────────────────────────────────
-- A pair of notes the person does not want connected. Without it, a
-- connection they removed would be proposed again by the next analysis —
-- the fastest way to teach someone to ignore the suggestions.
create table if not exists public.lifeos_brain_dismissals (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  from_id     uuid not null references public.lifeos_brain_items(id) on delete cascade,
  to_id       uuid not null references public.lifeos_brain_items(id) on delete cascade,
  created_at  timestamptz not null default now()
);

do $$
begin
  alter table public.lifeos_brain_dismissals
    add constraint lifeos_brain_dismissals_canonical check (from_id < to_id);
exception when duplicate_object then null;
end $$;

create unique index if not exists lifeos_brain_dismissals_pair_idx
  on public.lifeos_brain_dismissals (user_key, from_id, to_id);
create index if not exists lifeos_brain_dismissals_to_idx
  on public.lifeos_brain_dismissals (to_id);

alter table public.lifeos_brain_dismissals enable row level security;
drop policy if exists lifeos_brain_dismissals_owner on public.lifeos_brain_dismissals;
create policy lifeos_brain_dismissals_owner on public.lifeos_brain_dismissals
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);
