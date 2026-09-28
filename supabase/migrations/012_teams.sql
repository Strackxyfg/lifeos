-- ════════════════════════════════════════════════════════════════════
-- LifeOS — Teams and circles.
-- Idempotent: safe to run twice. Depends on 007.
--
-- A team (a company) or a circle (founders who meet as peers) shares what
-- its members choose to share: notes, a weekly check-in, kudos, and an
-- anonymous pulse. It never reads a member's own brain — nothing here
-- references lifeos_brain_items, and no policy could reach it.
--
-- Membership changes go through the functions below (security definer),
-- which enforce the rules: exactly one owner; admins add members, only the
-- owner makes admins; an invitation fills seats one at a time, even under
-- concurrent use. Direct writes are limited by row policies AND column
-- privileges: a member can rename themselves, never promote themselves.
--
-- Until this runs, the app says teams need it and offers nothing else.
-- ════════════════════════════════════════════════════════════════════

-- ── Tables ───────────────────────────────────────────────────────────

create table if not exists public.lifeos_teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'company',
  seats       integer not null default 10,
  created_by  text not null,
  created_at  timestamptz not null default now()
);

do $$ begin
  alter table public.lifeos_teams add constraint lifeos_teams_name_chk check (char_length(btrim(name)) between 1 and 80);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_teams add constraint lifeos_teams_kind_chk check (kind in ('company', 'circle'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_teams add constraint lifeos_teams_seats_chk check (seats between 1 and 10000);
exception when duplicate_object then null; end $$;

create table if not exists public.lifeos_team_members (
  team_id       uuid not null references public.lifeos_teams(id) on delete cascade,
  user_key      text not null,
  role          text not null default 'member',
  -- What the team calls them: chosen by them, not read from their profile.
  display_name  text not null,
  title         text,
  joined_at     timestamptz not null default now(),
  primary key (team_id, user_key)
);

do $$ begin
  alter table public.lifeos_team_members add constraint lifeos_team_members_role_chk check (role in ('owner', 'admin', 'member'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_members add constraint lifeos_team_members_name_chk check (char_length(btrim(display_name)) between 1 and 80);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_members add constraint lifeos_team_members_title_chk check (title is null or char_length(title) <= 80);
exception when duplicate_object then null; end $$;

-- Exactly one owner per team (a handover demotes first, then promotes).
create unique index if not exists lifeos_team_members_one_owner
  on public.lifeos_team_members (team_id) where role = 'owner';
create index if not exists lifeos_team_members_user_idx on public.lifeos_team_members (user_key);

create table if not exists public.lifeos_team_invites (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.lifeos_teams(id) on delete cascade,
  -- Only the SHA-256 of the token: the link itself is shown once, never stored.
  token_hash  text not null unique,
  role        text not null default 'member',
  created_by  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  max_uses    integer not null default 1,
  uses        integer not null default 0,
  revoked_at  timestamptz
);

do $$ begin
  alter table public.lifeos_team_invites add constraint lifeos_team_invites_hash_chk check (token_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_invites add constraint lifeos_team_invites_role_chk check (role in ('admin', 'member'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_invites add constraint lifeos_team_invites_uses_chk check (max_uses between 1 and 1000 and uses between 0 and max_uses);
exception when duplicate_object then null; end $$;

create index if not exists lifeos_team_invites_team_idx on public.lifeos_team_invites (team_id);

create table if not exists public.lifeos_team_notes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.lifeos_teams(id) on delete cascade,
  user_key    text not null,
  -- The private note it was shared from, if any. Deliberately no foreign
  -- key: the team must not be able to reach, or even test for, a private row.
  source_id   uuid,
  category    text not null default 'thoughts',
  title       text not null,
  detail      text,
  concepts    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$ begin
  alter table public.lifeos_team_notes add constraint lifeos_team_notes_category_chk
    check (category in ('goals', 'ideas', 'thoughts', 'next', 'knowledge', 'insights'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_notes add constraint lifeos_team_notes_title_chk check (char_length(btrim(title)) between 1 and 300);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_notes add constraint lifeos_team_notes_detail_chk check (detail is null or char_length(detail) <= 4000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_notes add constraint lifeos_team_notes_concepts_chk check (jsonb_typeof(concepts) = 'array');
exception when duplicate_object then null; end $$;

create index if not exists lifeos_team_notes_team_idx on public.lifeos_team_notes (team_id, created_at desc);
-- A note is shared once with a given team.
create unique index if not exists lifeos_team_notes_source_idx
  on public.lifeos_team_notes (team_id, user_key, source_id) where source_id is not null;

create table if not exists public.lifeos_team_checkins (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.lifeos_teams(id) on delete cascade,
  user_key     text not null,
  week         text not null,
  done         text not null default '',
  focus        text not null default '',
  blocker      text not null default '',
  help_wanted  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (team_id, user_key, week)
);

do $$ begin
  alter table public.lifeos_team_checkins add constraint lifeos_team_checkins_week_chk check (week ~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_checkins add constraint lifeos_team_checkins_len_chk
    check (char_length(done) <= 1000 and char_length(focus) <= 1000 and char_length(blocker) <= 1000);
exception when duplicate_object then null; end $$;

create index if not exists lifeos_team_checkins_week_idx on public.lifeos_team_checkins (team_id, week);

-- "I can help": a teammate answering a blocker.
create table if not exists public.lifeos_team_help (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.lifeos_teams(id) on delete cascade,
  checkin_id  uuid not null references public.lifeos_team_checkins(id) on delete cascade,
  user_key    text not null,
  created_at  timestamptz not null default now(),
  unique (checkin_id, user_key)
);

create table if not exists public.lifeos_team_kudos (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.lifeos_teams(id) on delete cascade,
  from_key    text not null,
  to_key      text not null,
  message     text not null,
  created_at  timestamptz not null default now()
);

do $$ begin
  alter table public.lifeos_team_kudos add constraint lifeos_team_kudos_msg_chk check (char_length(btrim(message)) between 1 and 280);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_kudos add constraint lifeos_team_kudos_self_chk check (from_key <> to_key);
exception when duplicate_object then null; end $$;

create index if not exists lifeos_team_kudos_team_idx on public.lifeos_team_kudos (team_id, created_at desc);

-- The weekly pulse: each answer readable by its author only; the team sees
-- averages, and only from five answers up (lifeos_pulse_summary).
create table if not exists public.lifeos_team_pulse (
  team_id     uuid not null references public.lifeos_teams(id) on delete cascade,
  user_key    text not null,
  week        text not null,
  energy      smallint not null,
  load        smallint not null,
  updated_at  timestamptz not null default now(),
  primary key (team_id, user_key, week)
);

do $$ begin
  alter table public.lifeos_team_pulse add constraint lifeos_team_pulse_values_chk check (energy between 1 and 5 and load between 1 and 5);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_pulse add constraint lifeos_team_pulse_week_chk check (week ~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$');
exception when duplicate_object then null; end $$;

-- Seats can shrink only down to the people already in.
create or replace function public.lifeos_teams_seats_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.seats < (select count(*) from public.lifeos_team_members m where m.team_id = new.id) then
    raise exception 'seats_below_members' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists lifeos_teams_seats_guard on public.lifeos_teams;
create trigger lifeos_teams_seats_guard before update of seats on public.lifeos_teams
  for each row execute function public.lifeos_teams_seats_guard();

-- ── Who the caller is in a team ──────────────────────────────────────
-- Definer functions, so policies can ask without recursing through the
-- members table's own policy.

create or replace function public.lifeos_team_role(p_team uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.lifeos_team_members m
  where m.team_id = p_team and m.user_key = auth.uid()::text
$$;

create or replace function public.lifeos_is_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lifeos_team_members m
    where m.team_id = p_team and m.user_key = auth.uid()::text
  )
$$;

-- ── Membership, through functions only ───────────────────────────────

create or replace function public.lifeos_create_team(p_name text, p_kind text, p_display text, p_seats integer default 10)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  -- A person is in a bounded number of teams: a script cannot mint thousands.
  if (select count(*) from public.lifeos_team_members m where m.user_key = v_uid) >= 50 then
    raise exception 'too_many_teams' using errcode = '23514';
  end if;
  insert into public.lifeos_teams (name, kind, seats, created_by)
    values (btrim(p_name), p_kind, coalesce(p_seats, 10), v_uid) returning id into v_id;
  insert into public.lifeos_team_members (team_id, user_key, role, display_name)
    values (v_id, v_uid, 'owner', btrim(p_display));
  return v_id;
end $$;

create or replace function public.lifeos_invite_preview(p_hash text)
returns table (team_id uuid, team_name text, team_kind text, members integer, state text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
  i public.lifeos_team_invites%rowtype;
  t public.lifeos_teams%rowtype;
  n integer;
  mem boolean;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  select * into i from public.lifeos_team_invites x where x.token_hash = p_hash;
  if not found or i.revoked_at is not null then
    return query select null::uuid, null::text, null::text, 0, 'invalid'::text;
    return;
  end if;
  select * into t from public.lifeos_teams x where x.id = i.team_id;
  select count(*) into n from public.lifeos_team_members m where m.team_id = i.team_id;
  select exists (select 1 from public.lifeos_team_members m where m.team_id = i.team_id and m.user_key = v_uid) into mem;
  return query select t.id, t.name, t.kind, n,
    case
      when mem then 'member'
      when i.expires_at <= now() then 'expired'
      when i.uses >= i.max_uses then 'used_up'
      when n >= t.seats then 'full'
      else 'ok'
    end;
end $$;

create or replace function public.lifeos_accept_invite(p_hash text, p_display text)
returns table (state text, team_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
  i public.lifeos_team_invites%rowtype;
  t public.lifeos_teams%rowtype;
  n integer;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  select * into i from public.lifeos_team_invites x where x.token_hash = p_hash for update;
  if not found or i.revoked_at is not null then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  -- The team row is locked too: two people taking the last seat at once
  -- queue here, and the second finds the team full.
  select * into t from public.lifeos_teams x where x.id = i.team_id for update;
  if exists (select 1 from public.lifeos_team_members m where m.team_id = i.team_id and m.user_key = v_uid) then
    return query select 'member'::text, i.team_id;
    return;
  end if;
  if i.expires_at <= now() then return query select 'expired'::text, null::uuid; return; end if;
  if i.uses >= i.max_uses then return query select 'used_up'::text, null::uuid; return; end if;
  select count(*) into n from public.lifeos_team_members m where m.team_id = i.team_id;
  if n >= t.seats then return query select 'full'::text, null::uuid; return; end if;
  insert into public.lifeos_team_members (team_id, user_key, role, display_name)
    values (i.team_id, v_uid, i.role, btrim(p_display));
  update public.lifeos_team_invites x set uses = x.uses + 1 where x.id = i.id;
  return query select 'ok'::text, i.team_id;
end $$;

create or replace function public.lifeos_set_member_role(p_team uuid, p_user text, p_role text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
  a text;
  b text;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_role not in ('owner', 'admin', 'member') then return 'invalid'; end if;
  if p_user = v_uid then return 'self'; end if;
  select m.role into a from public.lifeos_team_members m where m.team_id = p_team and m.user_key = v_uid for update;
  select m.role into b from public.lifeos_team_members m where m.team_id = p_team and m.user_key = p_user for update;
  if a is null or b is null then return 'not_found'; end if;
  -- Permission before anything else: a member learns nothing from trying.
  if a = 'member' then return 'forbidden'; end if;
  if b = p_role then return 'noop'; end if;
  if a = 'owner' then
    if p_role = 'owner' then
      -- Handover: demote first (one owner at a time), then promote.
      update public.lifeos_team_members m set role = 'admin' where m.team_id = p_team and m.user_key = v_uid;
    end if;
    update public.lifeos_team_members m set role = p_role where m.team_id = p_team and m.user_key = p_user;
    return 'ok';
  end if;
  if a = 'admin' and b = 'member' and p_role = 'admin' then
    update public.lifeos_team_members m set role = 'admin' where m.team_id = p_team and m.user_key = p_user;
    return 'ok';
  end if;
  return 'forbidden';
end $$;

create or replace function public.lifeos_remove_member(p_team uuid, p_user text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
  a text;
  b text;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  select m.role into a from public.lifeos_team_members m where m.team_id = p_team and m.user_key = v_uid;
  select m.role into b from public.lifeos_team_members m where m.team_id = p_team and m.user_key = p_user;
  if a is null or b is null then return 'not_found'; end if;
  if p_user = v_uid then
    -- The owner hands the team over (or deletes it) before leaving.
    if a = 'owner' then return 'forbidden'; end if;
  elsif b = 'owner' or not (a = 'owner' or (a = 'admin' and b = 'member')) then
    return 'forbidden';
  end if;
  delete from public.lifeos_team_members m where m.team_id = p_team and m.user_key = p_user;
  -- Their anonymous answers leave with them; what they shared stays shared.
  delete from public.lifeos_team_pulse x where x.team_id = p_team and x.user_key = p_user;
  return 'ok';
end $$;

create or replace function public.lifeos_pulse_summary(p_team uuid, p_week text)
returns table (responses integer, energy numeric, load numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  n integer;
  e numeric;
  l numeric;
begin
  if not public.lifeos_is_member(p_team) then raise exception 'forbidden' using errcode = '42501'; end if;
  select count(*), avg(x.energy), avg(x.load) into n, e, l
    from public.lifeos_team_pulse x where x.team_id = p_team and x.week = p_week;
  -- Fewer than five answers could be read back out of an average: none is given.
  if n < 5 then
    return query select n, null::numeric, null::numeric;
  else
    return query select n, round(e, 1), round(l, 1);
  end if;
end $$;

-- Erasing the caller from every team (with "delete all my data"). A team
-- they own passes to its longest-standing admin, else member; a team left
-- empty is deleted.
create or replace function public.lifeos_forget_me() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
  r record;
  heir text;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  for r in select m.team_id from public.lifeos_team_members m where m.user_key = v_uid and m.role = 'owner' loop
    select m.user_key into heir from public.lifeos_team_members m
      where m.team_id = r.team_id and m.user_key <> v_uid
      order by (m.role = 'admin') desc, m.joined_at asc limit 1;
    delete from public.lifeos_team_members m where m.team_id = r.team_id and m.user_key = v_uid;
    if heir is null then
      delete from public.lifeos_teams t where t.id = r.team_id;
    else
      update public.lifeos_team_members m set role = 'owner' where m.team_id = r.team_id and m.user_key = heir;
    end if;
  end loop;
  delete from public.lifeos_team_pulse x where x.user_key = v_uid;
  delete from public.lifeos_team_help x where x.user_key = v_uid;
  delete from public.lifeos_team_kudos x where x.from_key = v_uid or x.to_key = v_uid;
  delete from public.lifeos_team_checkins x where x.user_key = v_uid;
  delete from public.lifeos_team_notes x where x.user_key = v_uid;
  delete from public.lifeos_team_members m where m.user_key = v_uid;
end $$;

-- ── Row-level security ───────────────────────────────────────────────

alter table public.lifeos_teams enable row level security;
alter table public.lifeos_team_members enable row level security;
alter table public.lifeos_team_invites enable row level security;
alter table public.lifeos_team_notes enable row level security;
alter table public.lifeos_team_checkins enable row level security;
alter table public.lifeos_team_help enable row level security;
alter table public.lifeos_team_kudos enable row level security;
alter table public.lifeos_team_pulse enable row level security;

drop policy if exists lifeos_teams_read on public.lifeos_teams;
create policy lifeos_teams_read on public.lifeos_teams for select using (public.lifeos_is_member(id));
drop policy if exists lifeos_teams_update on public.lifeos_teams;
create policy lifeos_teams_update on public.lifeos_teams for update
  using (public.lifeos_team_role(id) in ('owner', 'admin'))
  with check (public.lifeos_team_role(id) in ('owner', 'admin'));
drop policy if exists lifeos_teams_delete on public.lifeos_teams;
create policy lifeos_teams_delete on public.lifeos_teams for delete using (public.lifeos_team_role(id) = 'owner');

drop policy if exists lifeos_team_members_read on public.lifeos_team_members;
create policy lifeos_team_members_read on public.lifeos_team_members for select using (public.lifeos_is_member(team_id));
drop policy if exists lifeos_team_members_self on public.lifeos_team_members;
create policy lifeos_team_members_self on public.lifeos_team_members for update
  using (user_key = auth.uid()::text) with check (user_key = auth.uid()::text);

drop policy if exists lifeos_team_invites_admin on public.lifeos_team_invites;
create policy lifeos_team_invites_admin on public.lifeos_team_invites for select
  using (public.lifeos_team_role(team_id) in ('owner', 'admin'));
drop policy if exists lifeos_team_invites_create on public.lifeos_team_invites;
create policy lifeos_team_invites_create on public.lifeos_team_invites for insert
  with check (
    created_by = auth.uid()::text
    and (public.lifeos_team_role(team_id) = 'owner' or (public.lifeos_team_role(team_id) = 'admin' and role = 'member'))
  );
drop policy if exists lifeos_team_invites_revoke on public.lifeos_team_invites;
create policy lifeos_team_invites_revoke on public.lifeos_team_invites for update
  using (public.lifeos_team_role(team_id) in ('owner', 'admin'))
  with check (public.lifeos_team_role(team_id) in ('owner', 'admin'));

drop policy if exists lifeos_team_notes_read on public.lifeos_team_notes;
create policy lifeos_team_notes_read on public.lifeos_team_notes for select using (public.lifeos_is_member(team_id));
drop policy if exists lifeos_team_notes_write on public.lifeos_team_notes;
create policy lifeos_team_notes_write on public.lifeos_team_notes for insert
  with check (user_key = auth.uid()::text and public.lifeos_is_member(team_id));
drop policy if exists lifeos_team_notes_edit on public.lifeos_team_notes;
create policy lifeos_team_notes_edit on public.lifeos_team_notes for update
  using (user_key = auth.uid()::text) with check (user_key = auth.uid()::text and public.lifeos_is_member(team_id));
drop policy if exists lifeos_team_notes_delete on public.lifeos_team_notes;
create policy lifeos_team_notes_delete on public.lifeos_team_notes for delete
  using (user_key = auth.uid()::text or public.lifeos_team_role(team_id) in ('owner', 'admin'));

drop policy if exists lifeos_team_checkins_read on public.lifeos_team_checkins;
create policy lifeos_team_checkins_read on public.lifeos_team_checkins for select using (public.lifeos_is_member(team_id));
drop policy if exists lifeos_team_checkins_write on public.lifeos_team_checkins;
create policy lifeos_team_checkins_write on public.lifeos_team_checkins for insert
  with check (user_key = auth.uid()::text and public.lifeos_is_member(team_id));
drop policy if exists lifeos_team_checkins_edit on public.lifeos_team_checkins;
create policy lifeos_team_checkins_edit on public.lifeos_team_checkins for update
  using (user_key = auth.uid()::text) with check (user_key = auth.uid()::text and public.lifeos_is_member(team_id));
drop policy if exists lifeos_team_checkins_delete on public.lifeos_team_checkins;
create policy lifeos_team_checkins_delete on public.lifeos_team_checkins for delete using (user_key = auth.uid()::text);

drop policy if exists lifeos_team_help_read on public.lifeos_team_help;
create policy lifeos_team_help_read on public.lifeos_team_help for select using (public.lifeos_is_member(team_id));
drop policy if exists lifeos_team_help_write on public.lifeos_team_help;
create policy lifeos_team_help_write on public.lifeos_team_help for insert
  with check (
    user_key = auth.uid()::text
    and public.lifeos_is_member(team_id)
    and exists (
      select 1 from public.lifeos_team_checkins c
      where c.id = checkin_id and c.team_id = lifeos_team_help.team_id and c.user_key <> auth.uid()::text
    )
  );
drop policy if exists lifeos_team_help_delete on public.lifeos_team_help;
create policy lifeos_team_help_delete on public.lifeos_team_help for delete using (user_key = auth.uid()::text);

drop policy if exists lifeos_team_kudos_read on public.lifeos_team_kudos;
create policy lifeos_team_kudos_read on public.lifeos_team_kudos for select using (public.lifeos_is_member(team_id));
drop policy if exists lifeos_team_kudos_write on public.lifeos_team_kudos;
create policy lifeos_team_kudos_write on public.lifeos_team_kudos for insert
  with check (
    from_key = auth.uid()::text
    and public.lifeos_is_member(team_id)
    and exists (select 1 from public.lifeos_team_members m where m.team_id = lifeos_team_kudos.team_id and m.user_key = to_key)
  );
drop policy if exists lifeos_team_kudos_delete on public.lifeos_team_kudos;
create policy lifeos_team_kudos_delete on public.lifeos_team_kudos for delete
  using (from_key = auth.uid()::text or public.lifeos_team_role(team_id) in ('owner', 'admin'));

drop policy if exists lifeos_team_pulse_own on public.lifeos_team_pulse;
create policy lifeos_team_pulse_own on public.lifeos_team_pulse for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text and public.lifeos_is_member(team_id));

-- ── Column privileges: what a direct update may touch ────────────────
-- Row policies say whose rows; these say which columns. Without them a
-- member could set their own `role` through their own row.

revoke update on public.lifeos_teams from anon, authenticated;
grant update (name, seats) on public.lifeos_teams to authenticated;
revoke update on public.lifeos_team_members from anon, authenticated;
grant update (display_name, title) on public.lifeos_team_members to authenticated;
revoke update on public.lifeos_team_invites from anon, authenticated;
grant update (revoked_at) on public.lifeos_team_invites to authenticated;
revoke update on public.lifeos_team_notes from anon, authenticated;
grant update (title, detail, category, concepts, updated_at) on public.lifeos_team_notes to authenticated;
revoke update on public.lifeos_team_checkins from anon, authenticated;
grant update (done, focus, blocker, help_wanted, updated_at) on public.lifeos_team_checkins to authenticated;
revoke update on public.lifeos_team_pulse from anon, authenticated;
grant update (energy, load, updated_at) on public.lifeos_team_pulse to authenticated;
revoke update on public.lifeos_team_help, public.lifeos_team_kudos from anon, authenticated;

-- ── Who may call the functions ───────────────────────────────────────

revoke all on function public.lifeos_team_role(uuid) from public, anon;
revoke all on function public.lifeos_is_member(uuid) from public, anon;
revoke all on function public.lifeos_create_team(text, text, text, integer) from public, anon;
revoke all on function public.lifeos_invite_preview(text) from public, anon;
revoke all on function public.lifeos_accept_invite(text, text) from public, anon;
revoke all on function public.lifeos_set_member_role(uuid, text, text) from public, anon;
revoke all on function public.lifeos_remove_member(uuid, text) from public, anon;
revoke all on function public.lifeos_pulse_summary(uuid, text) from public, anon;
revoke all on function public.lifeos_forget_me() from public, anon;
grant execute on function public.lifeos_team_role(uuid) to authenticated;
grant execute on function public.lifeos_is_member(uuid) to authenticated;
grant execute on function public.lifeos_create_team(text, text, text, integer) to authenticated;
grant execute on function public.lifeos_invite_preview(text) to authenticated;
grant execute on function public.lifeos_accept_invite(text, text) to authenticated;
grant execute on function public.lifeos_set_member_role(uuid, text, text) to authenticated;
grant execute on function public.lifeos_remove_member(uuid, text) to authenticated;
grant execute on function public.lifeos_pulse_summary(uuid, text) to authenticated;
grant execute on function public.lifeos_forget_me() to authenticated;
