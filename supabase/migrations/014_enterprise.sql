-- ════════════════════════════════════════════════════════════════════
-- LifeOS — Enterprise: verified domains, single sign-on, provisioning.
-- Idempotent: safe to run twice. Depends on 012 and 013.
--
-- A company team proves it owns an email domain (a DNS record), connects
-- its identity provider (SAML, through Supabase Auth), and lets that
-- provider keep its roster (SCIM 2.0). Whatever the server code does,
-- these hold here:
--
--   * Which identity provider a team trusts is written by the server
--     after it registered that provider itself (service role). An owner
--     cannot point their team at someone else's provider and collect its
--     users.
--   * A domain is marked verified by the server after it read the DNS
--     record (service role). An owner cannot mark it verified.
--   * When a team requires single sign-on, a member signed in any other
--     way is not a member of it: lifeos_team_role and lifeos_is_member,
--     which every team policy asks, say no. The owner is the one
--     exception, so a team can never be locked out of itself.
--   * The provisioned directory is the company's roster: read by the
--     team's owner and admins, written by the SCIM endpoint only. The
--     identity provider decides who is in the team; it never reaches
--     anyone's own brain.
--
-- Until this runs, the app says enterprise features need it.
-- ════════════════════════════════════════════════════════════════════

-- ── Who joined through single sign-on ────────────────────────────────

alter table public.lifeos_team_members add column if not exists via_sso boolean not null default false;
-- An admin made so by a directory group (not by a person): the directory
-- may take it back. A role someone chose by hand, it leaves alone.
alter table public.lifeos_team_members add column if not exists admin_by_directory boolean not null default false;

-- ── Verified domains ─────────────────────────────────────────────────

create table if not exists public.lifeos_team_domains (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.lifeos_teams(id) on delete cascade,
  domain       text not null,
  -- Published in DNS, so not a secret; still only owners and admins read it.
  token        text not null,
  verified_at  timestamptz,
  created_by   text not null,
  created_at   timestamptz not null default now()
);

do $$ begin
  alter table public.lifeos_team_domains add constraint lifeos_team_domains_domain_chk
    check (char_length(domain) <= 253 and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_domains add constraint lifeos_team_domains_token_chk check (token ~ '^[0-9a-f]{32}$');
exception when duplicate_object then null; end $$;

create unique index if not exists lifeos_team_domains_claim_idx on public.lifeos_team_domains (team_id, domain);
-- A domain is verified by one team at a time.
create unique index if not exists lifeos_team_domains_verified_idx on public.lifeos_team_domains (domain) where verified_at is not null;

-- ── The identity provider a team trusts ──────────────────────────────

create table if not exists public.lifeos_team_sso (
  team_id       uuid primary key references public.lifeos_teams(id) on delete cascade,
  -- Supabase Auth's id for the SAML provider, as Supabase returned it.
  provider_id   uuid not null unique,
  metadata_url  text,
  -- Anyone at a verified domain who signs in through the provider joins.
  jit           boolean not null default true,
  -- Members must be signed in through the provider to see the team.
  enforce       boolean not null default false,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$ begin
  alter table public.lifeos_team_sso add constraint lifeos_team_sso_url_chk
    check (metadata_url is null or (char_length(metadata_url) <= 2048 and metadata_url ~ '^https://'));
exception when duplicate_object then null; end $$;

-- ── Provisioning tokens ──────────────────────────────────────────────

create table if not exists public.lifeos_scim_tokens (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.lifeos_teams(id) on delete cascade,
  -- Only the SHA-256 of the token: it is shown once, never stored.
  token_hash    text not null unique,
  label         text not null,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

do $$ begin
  alter table public.lifeos_scim_tokens add constraint lifeos_scim_tokens_hash_chk check (token_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_scim_tokens add constraint lifeos_scim_tokens_label_chk check (char_length(btrim(label)) between 1 and 80);
exception when duplicate_object then null; end $$;

create index if not exists lifeos_scim_tokens_team_idx on public.lifeos_scim_tokens (team_id);

-- ── The provisioned directory ────────────────────────────────────────

create table if not exists public.lifeos_team_directory (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.lifeos_teams(id) on delete cascade,
  external_id   text,
  user_name     text not null,
  email         text,
  given_name    text,
  family_name   text,
  display_name  text,
  title         text,
  active        boolean not null default true,
  -- The account this entry signed in as, once they have (single sign-on).
  user_key      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$ begin
  alter table public.lifeos_team_directory add constraint lifeos_team_directory_len_chk check (
    char_length(btrim(user_name)) between 1 and 320
    and (external_id is null or char_length(external_id) between 1 and 256)
    and (email is null or char_length(email) <= 320)
    and (given_name is null or char_length(given_name) <= 200)
    and (family_name is null or char_length(family_name) <= 200)
    and (display_name is null or char_length(display_name) <= 200)
    and (title is null or char_length(title) <= 200)
  );
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_directory add constraint lifeos_team_directory_id_team_key unique (id, team_id);
exception when duplicate_object or duplicate_table then null; end $$;

-- SCIM says userName is unique and not case-sensitive.
create unique index if not exists lifeos_team_directory_name_idx on public.lifeos_team_directory (team_id, lower(user_name));
create unique index if not exists lifeos_team_directory_ext_idx on public.lifeos_team_directory (team_id, external_id) where external_id is not null;
-- One entry per account in a team.
create unique index if not exists lifeos_team_directory_user_idx on public.lifeos_team_directory (team_id, user_key) where user_key is not null;

create table if not exists public.lifeos_team_groups (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.lifeos_teams(id) on delete cascade,
  external_id   text,
  display_name  text not null,
  -- What being in the group grants in the team, chosen by the owner.
  role          text not null default 'member',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$ begin
  alter table public.lifeos_team_groups add constraint lifeos_team_groups_role_chk check (role in ('member', 'admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_groups add constraint lifeos_team_groups_len_chk
    check (char_length(btrim(display_name)) between 1 and 256 and (external_id is null or char_length(external_id) between 1 and 256));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lifeos_team_groups add constraint lifeos_team_groups_id_team_key unique (id, team_id);
exception when duplicate_object or duplicate_table then null; end $$;

create unique index if not exists lifeos_team_groups_name_idx on public.lifeos_team_groups (team_id, lower(display_name));
create unique index if not exists lifeos_team_groups_ext_idx on public.lifeos_team_groups (team_id, external_id) where external_id is not null;

-- A group's members, always of the group's own team (the two keys say so).
create table if not exists public.lifeos_team_group_members (
  group_id  uuid not null,
  entry_id  uuid not null,
  team_id   uuid not null,
  primary key (group_id, entry_id),
  foreign key (group_id, team_id) references public.lifeos_team_groups (id, team_id) on delete cascade,
  foreign key (entry_id, team_id) references public.lifeos_team_directory (id, team_id) on delete cascade
);

create index if not exists lifeos_team_group_members_entry_idx on public.lifeos_team_group_members (entry_id);

-- ── The session's identity provider ──────────────────────────────────
-- From the signed token only: the "amr" entry Supabase Auth writes for a
-- SAML sign-in, else the provider an SSO-only account was created by.

create or replace function public.lifeos_sso_provider() returns text
language sql stable set search_path = public as $$
  select coalesce(
    (select e->>'provider'
       from jsonb_array_elements(
         case when jsonb_typeof(auth.jwt()->'amr') = 'array' then auth.jwt()->'amr' else '[]'::jsonb end
       ) e
      where e->>'method' = 'sso/saml' and coalesce(e->>'provider', '') <> ''
      limit 1),
    substring(auth.jwt()->'app_metadata'->>'provider' from '^sso:([0-9A-Fa-f-]{36})$')
  )
$$;

-- ── Who the caller is in a team, now with single sign-on required ────
-- Same answers as in 012, except in a team that requires single sign-on:
-- there a member who is not signed in through its provider is not in it.
-- The owner always is.

create or replace function public.lifeos_team_role(p_team uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.lifeos_team_members m
  where m.team_id = p_team and m.user_key = auth.uid()::text
    and (
      m.role = 'owner'
      or not exists (select 1 from public.lifeos_team_sso s where s.team_id = p_team and s.enforce)
      or exists (select 1 from public.lifeos_team_sso s where s.team_id = p_team and s.provider_id::text = public.lifeos_sso_provider())
    )
$$;

create or replace function public.lifeos_is_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.lifeos_team_role(p_team) is not null
$$;

-- ── 012's membership functions, with the same rule ───────────────────

create or replace function public.lifeos_invite_preview(p_hash text)
returns table (team_id uuid, team_name text, team_kind text, members integer, state text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
  i public.lifeos_team_invites%rowtype;
  t public.lifeos_teams%rowtype;
  n integer;
  mem boolean;
  sso_only boolean;
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
  select exists (
    select 1 from public.lifeos_team_sso s
    where s.team_id = i.team_id and s.enforce and s.provider_id::text is distinct from public.lifeos_sso_provider()
  ) into sso_only;
  return query select t.id, t.name, t.kind, n,
    case
      when mem then 'member'
      when sso_only then 'sso'
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
  -- A team that requires single sign-on is joined through its provider.
  if exists (
    select 1 from public.lifeos_team_sso s
    where s.team_id = i.team_id and s.enforce and s.provider_id::text is distinct from public.lifeos_sso_provider()
  ) then
    return query select 'sso'::text, null::uuid;
    return;
  end if;
  if i.expires_at <= now() then return query select 'expired'::text, null::uuid; return; end if;
  if i.uses >= i.max_uses then return query select 'used_up'::text, null::uuid; return; end if;
  select count(*) into n from public.lifeos_team_members m where m.team_id = i.team_id;
  if n >= t.seats then return query select 'full'::text, null::uuid; return; end if;
  insert into public.lifeos_team_members (team_id, user_key, role, display_name, via_sso)
    values (i.team_id, v_uid, i.role, btrim(p_display), exists (
      select 1 from public.lifeos_team_sso s where s.team_id = i.team_id and s.provider_id::text = public.lifeos_sso_provider()
    ));
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
  -- Not signed in as the team requires: not a member, for this too.
  if a is not null and public.lifeos_team_role(p_team) is null then a := null; end if;
  if a is null or b is null then return 'not_found'; end if;
  -- Permission before anything else: a member learns nothing from trying.
  if a = 'member' then return 'forbidden'; end if;
  if b = p_role then return 'noop'; end if;
  -- A role chosen by hand is no longer the directory's to take back.
  if a = 'owner' then
    if p_role = 'owner' then
      -- Handover: demote first (one owner at a time), then promote.
      update public.lifeos_team_members m set role = 'admin', admin_by_directory = false where m.team_id = p_team and m.user_key = v_uid;
    end if;
    update public.lifeos_team_members m set role = p_role, admin_by_directory = false where m.team_id = p_team and m.user_key = p_user;
    return 'ok';
  end if;
  if a = 'admin' and b = 'member' and p_role = 'admin' then
    update public.lifeos_team_members m set role = 'admin', admin_by_directory = false where m.team_id = p_team and m.user_key = p_user;
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
  -- Leaving is always allowed; removing someone else needs the team's sign-in.
  if p_user <> v_uid and a is not null and public.lifeos_team_role(p_team) is null then a := null; end if;
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

-- 013's welcome pack: the role, as the team requires it to be signed in.
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
  v_role := public.lifeos_team_role(v_team);
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'only an owner or an admin pins' using errcode = '42501';
  end if;
  update public.lifeos_team_notes n
     set pinned = p_pinned,
         pinned_at = case when p_pinned then now() else null end
   where n.id = p_note;
end $$;

-- Erasing the caller (012), who also leaves every roster they were linked to.
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
  -- The company's roster keeps its entry (the provider owns it); the link to this account goes.
  update public.lifeos_team_directory d set user_key = null, updated_at = now() where d.user_key = v_uid;
end $$;

-- ── Claiming a domain, creating a provisioning token ─────────────────

create or replace function public.lifeos_claim_domain(p_team uuid, p_domain text, p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if public.lifeos_team_role(p_team) is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select t.kind from public.lifeos_teams t where t.id = p_team) <> 'company' then
    raise exception 'not_company' using errcode = '23514';
  end if;
  select d.id into v_id from public.lifeos_team_domains d where d.team_id = p_team and d.domain = p_domain;
  if v_id is not null then return v_id; end if;
  if exists (select 1 from public.lifeos_team_domains d where d.domain = p_domain and d.verified_at is not null) then
    raise exception 'domain_taken' using errcode = '23505';
  end if;
  if (select count(*) from public.lifeos_team_domains d where d.team_id = p_team) >= 20 then
    raise exception 'too_many_domains' using errcode = '23514';
  end if;
  insert into public.lifeos_team_domains (team_id, domain, token, created_by)
    values (p_team, p_domain, p_token, v_uid) returning id into v_id;
  return v_id;
end $$;

create or replace function public.lifeos_create_scim_token(p_team uuid, p_hash text, p_label text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if public.lifeos_team_role(p_team) is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select t.kind from public.lifeos_teams t where t.id = p_team) <> 'company' then
    raise exception 'not_company' using errcode = '23514';
  end if;
  if (select count(*) from public.lifeos_scim_tokens k where k.team_id = p_team and k.revoked_at is null) >= 5 then
    raise exception 'too_many_tokens' using errcode = '23514';
  end if;
  insert into public.lifeos_scim_tokens (team_id, token_hash, label, created_by)
    values (p_team, p_hash, btrim(p_label), v_uid) returning id into v_id;
  return v_id;
end $$;

-- ── Keeping the team in step with the directory ──────────────────────
-- One entry at a time: an active entry linked to an account is a member
-- (if a seat is free); an inactive one is not. Being in a group the owner
-- mapped to "admin" makes an admin; leaving every such group undoes it —
-- only for an admin the directory made. The owner is never touched.
-- Triggers below run it on every change, whoever makes it.

create or replace function public.lifeos_directory_sync(p_entry uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  e public.lifeos_team_directory%rowtype;
  t public.lifeos_teams%rowtype;
  cur text;
  by_dir boolean;
  want_admin boolean;
  n integer;
  v_name text;
begin
  select * into e from public.lifeos_team_directory d where d.id = p_entry for update;
  if not found then return 'not_found'; end if;
  if e.user_key is null then return 'unlinked'; end if;
  select * into t from public.lifeos_teams x where x.id = e.team_id for update;
  -- The team is going (a cascade): nothing to keep in step.
  if not found then return 'not_found'; end if;
  select m.role, m.admin_by_directory into cur, by_dir from public.lifeos_team_members m where m.team_id = e.team_id and m.user_key = e.user_key;
  if cur = 'owner' then return 'owner'; end if;

  if not e.active then
    if cur is null then return 'inactive'; end if;
    delete from public.lifeos_team_members m where m.team_id = e.team_id and m.user_key = e.user_key;
    delete from public.lifeos_team_pulse x where x.team_id = e.team_id and x.user_key = e.user_key;
    return 'removed';
  end if;

  select exists (
    select 1 from public.lifeos_team_group_members gm
    join public.lifeos_team_groups g on g.id = gm.group_id
    where gm.entry_id = e.id and g.role = 'admin'
  ) into want_admin;

  if cur is null then
    select count(*) into n from public.lifeos_team_members m where m.team_id = e.team_id;
    if n >= t.seats then return 'full'; end if;
    v_name := left(coalesce(
      nullif(btrim(e.display_name), ''),
      nullif(btrim(concat_ws(' ', e.given_name, e.family_name)), ''),
      nullif(split_part(e.user_name, '@', 1), ''),
      'Member'
    ), 80);
    insert into public.lifeos_team_members (team_id, user_key, role, display_name, via_sso, admin_by_directory)
      values (e.team_id, e.user_key, case when want_admin then 'admin' else 'member' end, v_name, true, want_admin);
    return 'added';
  end if;

  if want_admin and cur = 'member' then
    update public.lifeos_team_members m set role = 'admin', admin_by_directory = true where m.team_id = e.team_id and m.user_key = e.user_key;
    return 'updated';
  end if;
  if not want_admin and cur = 'admin' and by_dir then
    update public.lifeos_team_members m set role = 'member', admin_by_directory = false where m.team_id = e.team_id and m.user_key = e.user_key;
    return 'updated';
  end if;
  return 'ok';
end $$;

create or replace function public.lifeos_team_directory_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.lifeos_directory_sync(new.id);
  return null;
end $$;
drop trigger if exists lifeos_team_directory_changed on public.lifeos_team_directory;
create trigger lifeos_team_directory_changed after insert or update of active, user_key on public.lifeos_team_directory
  for each row execute function public.lifeos_team_directory_changed();

create or replace function public.lifeos_team_group_members_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.lifeos_directory_sync(case when tg_op = 'DELETE' then old.entry_id else new.entry_id end);
  return null;
end $$;
drop trigger if exists lifeos_team_group_members_changed on public.lifeos_team_group_members;
create trigger lifeos_team_group_members_changed after insert or delete on public.lifeos_team_group_members
  for each row execute function public.lifeos_team_group_members_changed();

create or replace function public.lifeos_team_groups_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in select gm.entry_id from public.lifeos_team_group_members gm where gm.group_id = new.id loop
    perform public.lifeos_directory_sync(r.entry_id);
  end loop;
  return null;
end $$;
drop trigger if exists lifeos_team_groups_changed on public.lifeos_team_groups;
create trigger lifeos_team_groups_changed after update of role on public.lifeos_team_groups
  for each row execute function public.lifeos_team_groups_changed();

-- An entry removed from the directory takes its membership with it.
create or replace function public.lifeos_team_directory_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.user_key is not null then
    delete from public.lifeos_team_pulse x
     where x.team_id = old.team_id and x.user_key = old.user_key
       and exists (select 1 from public.lifeos_team_members m where m.team_id = old.team_id and m.user_key = old.user_key and m.role <> 'owner');
    delete from public.lifeos_team_members m
     where m.team_id = old.team_id and m.user_key = old.user_key and m.role <> 'owner';
  end if;
  return old;
end $$;
drop trigger if exists lifeos_team_directory_gone on public.lifeos_team_directory;
create trigger lifeos_team_directory_gone before delete on public.lifeos_team_directory
  for each row execute function public.lifeos_team_directory_gone();

-- The owner says what a group grants; its members follow at once.
create or replace function public.lifeos_set_group_role(p_group uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_role not in ('member', 'admin') then raise exception 'invalid' using errcode = '23514'; end if;
  select g.team_id into v_team from public.lifeos_team_groups g where g.id = p_group;
  if v_team is null then raise exception 'no such group' using errcode = 'P0002'; end if;
  if public.lifeos_team_role(v_team) is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  -- Its members follow through the trigger on groups.
  update public.lifeos_team_groups g set role = p_role, updated_at = now() where g.id = p_group and g.role is distinct from p_role;
end $$;

-- ── Joining through single sign-on ───────────────────────────────────
-- Called right after a SAML sign-in. The provider comes from the signed
-- token, the team from the provider; the directory decides if it has an
-- entry for the address, else "just in time" does — for an address at
-- one of the team's verified domains only.

create or replace function public.lifeos_sso_join()
returns table (state text, team_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
  v_provider text := public.lifeos_sso_provider();
  v_email text := lower(btrim(auth.jwt()->>'email'));
  s public.lifeos_team_sso%rowtype;
  t public.lifeos_teams%rowtype;
  e public.lifeos_team_directory%rowtype;
  r text;
  n integer;
  v_name text;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if v_provider is null then return query select 'not_sso'::text, null::uuid; return; end if;
  select * into s from public.lifeos_team_sso x where x.provider_id::text = v_provider;
  if not found then return query select 'no_team'::text, null::uuid; return; end if;
  if v_email is null or position('@' in v_email) < 2 then return query select 'no_email'::text, null::uuid; return; end if;

  select * into e from public.lifeos_team_directory d
   where d.team_id = s.team_id
     and (lower(d.user_name) = v_email or lower(d.email) = v_email)
     and (d.user_key is null or d.user_key = v_uid)
   order by (d.user_key is not null) desc
   limit 1
   for update;
  if found then
    if e.user_key is null then
      -- Another entry already linked to this account (a renamed address) lets go first.
      update public.lifeos_team_directory d set user_key = null, updated_at = now()
       where d.team_id = s.team_id and d.user_key = v_uid and d.id <> e.id;
      update public.lifeos_team_directory d set user_key = v_uid, updated_at = now() where d.id = e.id;
    end if;
    r := public.lifeos_directory_sync(e.id);
    if r in ('added', 'updated', 'ok', 'owner') then
      update public.lifeos_team_members m set via_sso = true where m.team_id = s.team_id and m.user_key = v_uid;
      return query select 'ok'::text, s.team_id; return;
    end if;
    if r = 'full' then return query select 'full'::text, s.team_id; return; end if;
    return query select 'deprovisioned'::text, null::uuid; return;
  end if;

  if exists (select 1 from public.lifeos_team_members m where m.team_id = s.team_id and m.user_key = v_uid) then
    update public.lifeos_team_members m set via_sso = true where m.team_id = s.team_id and m.user_key = v_uid;
    return query select 'member'::text, s.team_id; return;
  end if;
  if not s.jit or not exists (
    select 1 from public.lifeos_team_domains d
    where d.team_id = s.team_id and d.verified_at is not null and d.domain = split_part(v_email, '@', 2)
  ) then
    return query select 'not_provisioned'::text, null::uuid; return;
  end if;

  select * into t from public.lifeos_teams x where x.id = s.team_id for update;
  select count(*) into n from public.lifeos_team_members m where m.team_id = s.team_id;
  if n >= t.seats then return query select 'full'::text, s.team_id; return; end if;
  v_name := left(coalesce(
    nullif(btrim(auth.jwt()->'user_metadata'->>'full_name'), ''),
    nullif(btrim(auth.jwt()->'user_metadata'->>'name'), ''),
    split_part(v_email, '@', 1)
  ), 80);
  insert into public.lifeos_team_members (team_id, user_key, role, display_name, via_sso)
    values (s.team_id, v_uid, 'member', v_name, true);
  return query select 'ok'::text, s.team_id;
end $$;

-- ── Row-level security ───────────────────────────────────────────────

alter table public.lifeos_team_domains enable row level security;
alter table public.lifeos_team_sso enable row level security;
alter table public.lifeos_scim_tokens enable row level security;
alter table public.lifeos_team_directory enable row level security;
alter table public.lifeos_team_groups enable row level security;
alter table public.lifeos_team_group_members enable row level security;

drop policy if exists lifeos_team_domains_read on public.lifeos_team_domains;
create policy lifeos_team_domains_read on public.lifeos_team_domains for select
  using (public.lifeos_team_role(team_id) in ('owner', 'admin'));
drop policy if exists lifeos_team_domains_delete on public.lifeos_team_domains;
create policy lifeos_team_domains_delete on public.lifeos_team_domains for delete
  using (public.lifeos_team_role(team_id) = 'owner');

drop policy if exists lifeos_team_sso_read on public.lifeos_team_sso;
create policy lifeos_team_sso_read on public.lifeos_team_sso for select
  using (public.lifeos_team_role(team_id) in ('owner', 'admin'));
drop policy if exists lifeos_team_sso_update on public.lifeos_team_sso;
create policy lifeos_team_sso_update on public.lifeos_team_sso for update
  using (public.lifeos_team_role(team_id) = 'owner')
  with check (public.lifeos_team_role(team_id) = 'owner');

drop policy if exists lifeos_scim_tokens_read on public.lifeos_scim_tokens;
create policy lifeos_scim_tokens_read on public.lifeos_scim_tokens for select
  using (public.lifeos_team_role(team_id) = 'owner');
drop policy if exists lifeos_scim_tokens_revoke on public.lifeos_scim_tokens;
create policy lifeos_scim_tokens_revoke on public.lifeos_scim_tokens for update
  using (public.lifeos_team_role(team_id) = 'owner')
  with check (public.lifeos_team_role(team_id) = 'owner');

drop policy if exists lifeos_team_directory_read on public.lifeos_team_directory;
create policy lifeos_team_directory_read on public.lifeos_team_directory for select
  using (public.lifeos_team_role(team_id) in ('owner', 'admin'));
drop policy if exists lifeos_team_groups_read on public.lifeos_team_groups;
create policy lifeos_team_groups_read on public.lifeos_team_groups for select
  using (public.lifeos_team_role(team_id) in ('owner', 'admin'));
drop policy if exists lifeos_team_group_members_read on public.lifeos_team_group_members;
create policy lifeos_team_group_members_read on public.lifeos_team_group_members for select
  using (public.lifeos_team_role(team_id) in ('owner', 'admin'));

-- ── Column privileges: what a direct write may touch ─────────────────

revoke insert, update on public.lifeos_team_domains from anon, authenticated;
revoke insert, update, delete on public.lifeos_team_sso from anon, authenticated;
grant update (jit, enforce, updated_at) on public.lifeos_team_sso to authenticated;
revoke insert, update, delete on public.lifeos_scim_tokens from anon, authenticated;
grant update (revoked_at) on public.lifeos_scim_tokens to authenticated;
revoke insert, update, delete on public.lifeos_team_directory from anon, authenticated;
revoke insert, update, delete on public.lifeos_team_groups from anon, authenticated;
revoke insert, update, delete on public.lifeos_team_group_members from anon, authenticated;
-- 012 gave members (display_name, title) only; via_sso stays out of reach.

-- ── Who may call the functions ───────────────────────────────────────

revoke all on function public.lifeos_sso_provider() from public, anon;
revoke all on function public.lifeos_claim_domain(uuid, text, text) from public, anon;
revoke all on function public.lifeos_create_scim_token(uuid, text, text) from public, anon;
revoke all on function public.lifeos_set_group_role(uuid, text) from public, anon;
revoke all on function public.lifeos_sso_join() from public, anon;
revoke all on function public.lifeos_directory_sync(uuid) from public, anon, authenticated;
grant execute on function public.lifeos_sso_provider() to authenticated;
grant execute on function public.lifeos_claim_domain(uuid, text, text) to authenticated;
grant execute on function public.lifeos_create_scim_token(uuid, text, text) to authenticated;
grant execute on function public.lifeos_set_group_role(uuid, text) to authenticated;
grant execute on function public.lifeos_sso_join() to authenticated;
grant execute on function public.lifeos_directory_sync(uuid) to service_role;
