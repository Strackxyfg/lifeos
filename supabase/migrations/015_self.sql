-- ════════════════════════════════════════════════════════════════════
-- LifeOS — The double: what the second brain understands of the person.
-- Idempotent: safe to run twice. Depends on 002 (brain items).
--
-- Three tables, each the person's own and nobody else's (RLS):
--   · traits   — their portrait: short statements about them, each resting
--                on their own words (quotes from their notes), proposed by
--                the double and confirmed, corrected or rejected by them.
--                A rejected trait is kept, so it is never proposed again.
--   · checkins — how they are (mood, energy, 1–5) and the day's question
--                they answered; the answer itself is a note in the brain.
--   · advice   — what they did with a piece of advice: set aside for good,
--                put off until a date, or done.
--
-- Until this runs, the app degrades instead of breaking: the double's page
-- says it needs this migration; the brain works as before.
-- ════════════════════════════════════════════════════════════════════

-- ── The portrait ──────────────────────────────────────────────────
create table if not exists public.lifeos_self_traits (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  dimension   text not null,
  statement   text not null,
  -- [{ "noteId": "<uuid>", "quote": "their words" }]
  evidence    jsonb not null default '[]'::jsonb,
  status      text not null default 'proposed',
  origin      text not null default 'ai',
  -- The statement's meaningful words, normalised: the same trait proposed
  -- twice is recognised, and a rejected one is never proposed again.
  key         text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
begin
  alter table public.lifeos_self_traits
    add constraint lifeos_self_traits_dimension_chk check (
      dimension in ('values', 'drives', 'strengths', 'obstacles', 'rhythms', 'principles', 'people', 'interests')
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_self_traits
    add constraint lifeos_self_traits_status_chk check (status in ('proposed', 'confirmed', 'rejected'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_self_traits
    add constraint lifeos_self_traits_origin_chk check (origin in ('ai', 'person'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_self_traits
    add constraint lifeos_self_traits_text_chk check (
      char_length(statement) between 1 and 240 and char_length(key) between 1 and 240
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_self_traits
    add constraint lifeos_self_traits_evidence_chk check (
      jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 12
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_self_traits
    add constraint lifeos_self_traits_key unique (user_key, dimension, key);
exception when duplicate_object or duplicate_table then null;
end $$;

create index if not exists lifeos_self_traits_owner_idx
  on public.lifeos_self_traits (user_key, status);

alter table public.lifeos_self_traits enable row level security;
drop policy if exists lifeos_self_traits_owner on public.lifeos_self_traits;
create policy lifeos_self_traits_owner on public.lifeos_self_traits
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);

-- ── Check-ins ─────────────────────────────────────────────────────
-- `day` and `hour` are the person's own clock when they said it, fixed
-- then: rhythms ("your energy is higher in the morning") read them, and a
-- later change of time zone must not rewrite the past.
create table if not exists public.lifeos_self_checkins (
  id           uuid primary key default gen_random_uuid(),
  user_key     text not null,
  at           timestamptz not null default now(),
  day          date not null,
  hour         smallint not null,
  mood         smallint,
  energy       smallint,
  question_id  text,
  -- The note the answer became. Deleting the note keeps the check-in.
  note_id      uuid references public.lifeos_brain_items(id) on delete set null,
  created_at   timestamptz not null default now()
);

do $$
begin
  alter table public.lifeos_self_checkins
    add constraint lifeos_self_checkins_scale_chk check (
      (mood is null or mood between 1 and 5) and (energy is null or energy between 1 and 5)
      and hour between 0 and 23
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_self_checkins
    add constraint lifeos_self_checkins_something_chk check (
      mood is not null or energy is not null or question_id is not null
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_self_checkins
    add constraint lifeos_self_checkins_question_chk check (question_id is null or char_length(question_id) <= 120);
exception when duplicate_object then null;
end $$;

create index if not exists lifeos_self_checkins_day_idx
  on public.lifeos_self_checkins (user_key, day);

alter table public.lifeos_self_checkins enable row level security;
drop policy if exists lifeos_self_checkins_owner on public.lifeos_self_checkins;
create policy lifeos_self_checkins_owner on public.lifeos_self_checkins
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);

-- ── What was done with each piece of advice ───────────────────────
create table if not exists public.lifeos_self_advice (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  advice_key  text not null,
  status      text not null,
  until       timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
begin
  alter table public.lifeos_self_advice
    add constraint lifeos_self_advice_status_chk check (
      status in ('dismissed', 'snoozed', 'done') and (status <> 'snoozed' or until is not null)
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_self_advice
    add constraint lifeos_self_advice_key_chk check (char_length(advice_key) between 1 and 200);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_self_advice
    add constraint lifeos_self_advice_key unique (user_key, advice_key);
exception when duplicate_object or duplicate_table then null;
end $$;

alter table public.lifeos_self_advice enable row level security;
drop policy if exists lifeos_self_advice_owner on public.lifeos_self_advice;
create policy lifeos_self_advice_owner on public.lifeos_self_advice
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);
