-- ════════════════════════════════════════════════════════════════════
-- LifeOS — Sales: the business that sells, its clients, its catalogue, its
-- quotes, invoices and credit notes. Idempotent; depends only on auth.
--
--   · lifeos_sales_issuer    — the seller's identity (one row per person)
--   · lifeos_clients         — clients (archived, never deleted)
--   · lifeos_catalog         — products and services
--   · lifeos_sales_docs      — documents; a number only through issuing
--   · lifeos_sales_counters  — the last number of each series (kind, year)
--
-- The rules of French invoicing are kept by the database itself:
--   · a document gets its number only from lifeos_issue_sales_doc(), the
--     next of its series, allocated under a row lock — never shared, never
--     skipped (above 9999 the number simply grows: lpad would truncate);
--   · an issued document's number, kind, content, totals and issue time
--     never change, and it is never deleted — except by
--     lifeos_sales_erase(), when the person erases their own data;
--   · the counters are written only by those functions, and survive an
--     erasure, so a series never starts over.
-- Until this runs, the sales pages say they need it; nothing else changes.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.lifeos_sales_issuer (
  user_key    text primary key,
  data        jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 65536),
  updated_at  timestamptz not null default now()
);

create table if not exists public.lifeos_clients (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  name        text not null check (char_length(name) between 1 and 200),
  data        jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 65536),
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists lifeos_clients_owner_idx on public.lifeos_clients (user_key, name);

create table if not exists public.lifeos_catalog (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  name        text not null check (char_length(name) between 1 and 200),
  data        jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 65536),
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists lifeos_catalog_owner_idx on public.lifeos_catalog (user_key, name);

create table if not exists public.lifeos_sales_docs (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  kind        text not null check (kind in ('quote', 'invoice', 'credit')),
  number      text,
  state       text not null default 'open' check (state in ('open', 'accepted', 'declined', 'invoiced', 'cancelled')),
  content     jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 1048576),
  totals      jsonb not null check (jsonb_typeof(totals) = 'object'),
  payments    jsonb not null default '[]'::jsonb check (jsonb_typeof(payments) = 'array'),
  issued_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists lifeos_sales_docs_number_idx on public.lifeos_sales_docs (user_key, number) where number is not null;
create index if not exists lifeos_sales_docs_owner_idx on public.lifeos_sales_docs (user_key, updated_at desc);

create table if not exists public.lifeos_sales_counters (
  user_key  text not null,
  kind      text not null check (kind in ('quote', 'invoice', 'credit')),
  year      integer not null check (year between 2000 and 2999),
  last      integer not null check (last >= 1),
  primary key (user_key, kind, year)
);

-- ── Ownership ─────────────────────────────────────────────────────
alter table public.lifeos_sales_issuer enable row level security;
alter table public.lifeos_clients enable row level security;
alter table public.lifeos_catalog enable row level security;
alter table public.lifeos_sales_docs enable row level security;
alter table public.lifeos_sales_counters enable row level security; -- no policy: only the functions below touch it

drop policy if exists lifeos_sales_issuer_owner on public.lifeos_sales_issuer;
create policy lifeos_sales_issuer_owner on public.lifeos_sales_issuer
  for all using (user_key = auth.uid()::text) with check (user_key = auth.uid()::text);

drop policy if exists lifeos_clients_owner on public.lifeos_clients;
create policy lifeos_clients_owner on public.lifeos_clients
  for all using (user_key = auth.uid()::text) with check (user_key = auth.uid()::text);

drop policy if exists lifeos_catalog_owner on public.lifeos_catalog;
create policy lifeos_catalog_owner on public.lifeos_catalog
  for all using (user_key = auth.uid()::text) with check (user_key = auth.uid()::text);

drop policy if exists lifeos_sales_docs_read on public.lifeos_sales_docs;
create policy lifeos_sales_docs_read on public.lifeos_sales_docs
  for select using (user_key = auth.uid()::text);
drop policy if exists lifeos_sales_docs_insert on public.lifeos_sales_docs;
create policy lifeos_sales_docs_insert on public.lifeos_sales_docs
  for insert with check (user_key = auth.uid()::text and number is null and issued_at is null);
drop policy if exists lifeos_sales_docs_update on public.lifeos_sales_docs;
create policy lifeos_sales_docs_update on public.lifeos_sales_docs
  for update using (user_key = auth.uid()::text) with check (user_key = auth.uid()::text);
drop policy if exists lifeos_sales_docs_delete on public.lifeos_sales_docs;
create policy lifeos_sales_docs_delete on public.lifeos_sales_docs
  for delete using (user_key = auth.uid()::text and number is null);

-- ── An issued document stays as it was issued ─────────────────────
create or replace function public.lifeos_sales_docs_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.number is not null and coalesce(current_setting('lifeos.sales_erasing', true), '') <> 'on' then
      raise exception 'An issued document cannot be deleted' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.number is not null or new.issued_at is not null then
      raise exception 'A number is given only by issuing' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.number is not null then
    if new.number is distinct from old.number or new.kind is distinct from old.kind or new.content is distinct from old.content
       or new.totals is distinct from old.totals or new.issued_at is distinct from old.issued_at or new.user_key is distinct from old.user_key then
      raise exception 'An issued document cannot be changed' using errcode = 'check_violation';
    end if;
  elsif (new.number is not null or new.issued_at is not null) and coalesce(current_setting('lifeos.sales_issuing', true), '') <> 'on' then
    raise exception 'A number is given only by issuing' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists lifeos_sales_docs_guard on public.lifeos_sales_docs;
create trigger lifeos_sales_docs_guard
  before insert or update or delete on public.lifeos_sales_docs
  for each row execute function public.lifeos_sales_docs_guard();

-- ── Issuing: the next number of the series, and the frozen content ─
create or replace function public.lifeos_issue_sales_doc(p_id uuid, p_content jsonb, p_totals jsonb, p_year integer)
returns public.lifeos_sales_docs
language plpgsql security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
  d public.lifeos_sales_docs;
  seq integer;
  prefix text;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2999 or jsonb_typeof(p_content) <> 'object' or jsonb_typeof(p_totals) <> 'object' then
    raise exception 'Invalid issue' using errcode = 'invalid_parameter_value';
  end if;
  select * into d from public.lifeos_sales_docs where id = p_id and user_key = uid for update;
  if not found then
    raise exception 'Missing document' using errcode = 'no_data_found';
  end if;
  if d.number is not null then
    raise exception 'Already issued' using errcode = 'check_violation';
  end if;
  insert into public.lifeos_sales_counters as c (user_key, kind, year, last)
  values (uid, d.kind, p_year, 1)
  on conflict (user_key, kind, year) do update set last = c.last + 1
  returning c.last into seq;
  prefix := case d.kind when 'quote' then 'DEV' when 'invoice' then 'FAC' else 'AV' end;
  perform set_config('lifeos.sales_issuing', 'on', true);
  update public.lifeos_sales_docs
     set number = prefix || '-' || p_year || '-' || case when seq >= 1000 then seq::text else lpad(seq::text, 4, '0') end,
         content = p_content,
         totals = p_totals,
         issued_at = now(),
         updated_at = now()
   where id = p_id
  returning * into d;
  perform set_config('lifeos.sales_issuing', 'off', true);
  return d;
end $$;

revoke all on function public.lifeos_issue_sales_doc(uuid, jsonb, jsonb, integer) from public;
grant execute on function public.lifeos_issue_sales_doc(uuid, jsonb, jsonb, integer) to authenticated;

-- ── Erasing one's own data ────────────────────────────────────────
create or replace function public.lifeos_sales_erase()
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('lifeos.sales_erasing', 'on', true);
  delete from public.lifeos_sales_docs where user_key = uid;
  delete from public.lifeos_clients where user_key = uid;
  delete from public.lifeos_catalog where user_key = uid;
  delete from public.lifeos_sales_issuer where user_key = uid;
  perform set_config('lifeos.sales_erasing', 'off', true);
end $$;

revoke all on function public.lifeos_sales_erase() from public;
grant execute on function public.lifeos_sales_erase() to authenticated;
