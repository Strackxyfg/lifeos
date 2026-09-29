-- ════════════════════════════════════════════════════════════════════
-- LifeOS — For founders: dated money, cash and runway, deals' next
-- actions as reminders, the Friday review, and a team's welcome pack.
-- Idempotent: safe to run twice. Depends on 002 (workspace), 011
-- (reminders) and 012 (teams).
--
-- Until this runs, the app degrades instead of breaking: finance shows
-- its totals without treasury or runway, the CRM keeps its next actions
-- as text, the review and the welcome pack say they need this migration.
-- ════════════════════════════════════════════════════════════════════

-- ── Transactions: the day it happened ─────────────────────────────
-- The old `date` column is free text ("Jul 26") and stays as typed. A
-- treasury needs a real date: `occurred_on`. Nothing is backfilled here —
-- a guess about which year "Jul 26" meant would be a fabrication. The app
-- proposes dates it can read and the person confirms them.
alter table public.lifeos_transactions add column if not exists occurred_on date;

create index if not exists lifeos_transactions_occurred_idx
  on public.lifeos_transactions (user_key, occurred_on);

-- ── Deals: when the next action is due ────────────────────────────
alter table public.lifeos_deals add column if not exists next_at timestamptz;

-- ── Reminders: the deal they are about ────────────────────────────
-- Deleting the deal keeps the reminder, as text (like a note's).
alter table public.lifeos_reminders
  add column if not exists deal_id uuid references public.lifeos_deals(id) on delete set null;

create index if not exists lifeos_reminders_deal_idx
  on public.lifeos_reminders (deal_id)
  where deal_id is not null;

-- ── Cash balances, as the person states them ──────────────────────
-- "On 30 September, 42 000 in the bank": the anchor from which the
-- treasury is carried forward by dated transactions. One per day.
create table if not exists public.lifeos_balances (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  amount      numeric(16, 2) not null,
  as_of       date not null,
  note        text,
  created_at  timestamptz not null default now()
);

do $$
begin
  alter table public.lifeos_balances
    add constraint lifeos_balances_day_key unique (user_key, as_of);
exception when duplicate_object or duplicate_table then null;
end $$;

do $$
begin
  alter table public.lifeos_balances
    add constraint lifeos_balances_amount_chk check (amount between -1000000000000 and 1000000000000);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_balances
    add constraint lifeos_balances_note_chk check (note is null or char_length(note) <= 300);
exception when duplicate_object then null;
end $$;

alter table public.lifeos_balances enable row level security;
drop policy if exists lifeos_balances_owner on public.lifeos_balances;
create policy lifeos_balances_owner on public.lifeos_balances
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);

-- ── The Friday review ─────────────────────────────────────────────
-- One per ISO week (keyed by its Monday): what went well, what blocked,
-- what was learnt, next week's focus, and the decisions taken — each with
-- why and when to look at it again.
create table if not exists public.lifeos_reviews (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  week_start  date not null,
  wins        text not null default '',
  blockers    text not null default '',
  lessons     text not null default '',
  focus       text not null default '',
  decisions   jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
begin
  alter table public.lifeos_reviews
    add constraint lifeos_reviews_week_key unique (user_key, week_start);
exception when duplicate_object or duplicate_table then null;
end $$;

do $$
begin
  alter table public.lifeos_reviews
    add constraint lifeos_reviews_monday_chk check (extract(isodow from week_start) = 1);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_reviews
    add constraint lifeos_reviews_text_chk check (
      char_length(wins) <= 4000 and char_length(blockers) <= 4000
      and char_length(lessons) <= 4000 and char_length(focus) <= 1000
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lifeos_reviews
    add constraint lifeos_reviews_decisions_chk check (
      jsonb_typeof(decisions) = 'array' and jsonb_array_length(decisions) <= 20
    );
exception when duplicate_object then null;
end $$;

alter table public.lifeos_reviews enable row level security;
drop policy if exists lifeos_reviews_owner on public.lifeos_reviews;
create policy lifeos_reviews_owner on public.lifeos_reviews
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);

-- ── A team's welcome pack ─────────────────────────────────────────
-- Shared notes an owner or admin pins for whoever joins: "read this on
-- your first day". Pinning goes through a function that checks the role;
-- members keep no direct write on the column.
alter table public.lifeos_team_notes add column if not exists pinned boolean not null default false;
alter table public.lifeos_team_notes add column if not exists pinned_at timestamptz;

revoke update (pinned, pinned_at) on public.lifeos_team_notes from anon, authenticated;

-- Nor may a note arrive already pinned: sharing is not pinning.
create or replace function public.lifeos_team_notes_unpinned() returns trigger
language plpgsql
as $$
begin
  new.pinned := false;
  new.pinned_at := null;
  return new;
end;
$$;

drop trigger if exists lifeos_team_notes_unpinned on public.lifeos_team_notes;
create trigger lifeos_team_notes_unpinned
  before insert on public.lifeos_team_notes
  for each row execute function public.lifeos_team_notes_unpinned();

create or replace function public.lifeos_pin_team_note(p_note uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_team uuid;
  v_role text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select n.team_id into v_team from public.lifeos_team_notes n where n.id = p_note;
  if v_team is null then
    raise exception 'no such note' using errcode = 'P0002';
  end if;
  select m.role into v_role from public.lifeos_team_members m where m.team_id = v_team and m.user_key = v_uid;
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'only an owner or an admin pins' using errcode = '42501';
  end if;
  update public.lifeos_team_notes n
     set pinned = p_pinned,
         pinned_at = case when p_pinned then now() else null end
   where n.id = p_note;
end;
$$;

revoke all on function public.lifeos_pin_team_note(uuid, boolean) from public;
grant execute on function public.lifeos_pin_team_note(uuid, boolean) to authenticated;
