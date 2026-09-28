-- ════════════════════════════════════════════════════════════════════
-- LifeOS — Reminders.
-- Idempotent: safe to run twice. Depends on 007 (the brain's notes).
--
-- Until this runs, the app degrades instead of breaking: the dashboard says
-- reminders need this migration and offers nothing it could not keep.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.lifeos_reminders (
  id           uuid primary key default gen_random_uuid(),
  user_key     text not null,
  title        text not null,
  -- When it is next due, and the first occurrence a series counts from
  -- (so "the 31st of each month" is the 30th in April and the 31st in May).
  due_at       timestamptz not null,
  anchor_at    timestamptz not null,
  repeat       text not null default 'none',
  -- The IANA zone whose clock it keeps: "every day at 9" is 9 there, in
  -- winter and in summer.
  zone         text not null default 'UTC',
  done         boolean not null default false,
  done_at      timestamptz,
  -- The note it is about. Deleting the note keeps the reminder, as text.
  note_id      uuid references public.lifeos_brain_items(id) on delete set null,
  -- When the person was told of this occurrence, in the app or on Telegram:
  -- nothing is ever announced twice.
  notified_at  timestamptz,
  created_at   timestamptz not null default now()
);

do $$
begin
  alter table public.lifeos_reminders
    add constraint lifeos_reminders_title_chk check (char_length(btrim(title)) between 1 and 300);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_reminders
    add constraint lifeos_reminders_repeat_chk check (repeat in ('none', 'daily', 'weekdays', 'weekly', 'monthly'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_reminders
    add constraint lifeos_reminders_zone_chk check (char_length(zone) between 1 and 64);
exception when duplicate_object then null;
end $$;

-- A done reminder says when. (A repeating one keeps its last `done_at`
-- while it waits for its next occurrence.)
do $$
begin
  alter table public.lifeos_reminders
    add constraint lifeos_reminders_done_chk check (not done or done_at is not null);
exception when duplicate_object then null;
end $$;

-- The person's list, soonest first.
create index if not exists lifeos_reminders_user_idx
  on public.lifeos_reminders (user_key, done, due_at);
-- What the dispatcher looks for: due, open, not yet told.
create index if not exists lifeos_reminders_due_idx
  on public.lifeos_reminders (due_at)
  where not done and notified_at is null;

alter table public.lifeos_reminders enable row level security;
drop policy if exists lifeos_reminders_owner on public.lifeos_reminders;
create policy lifeos_reminders_owner on public.lifeos_reminders
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);
