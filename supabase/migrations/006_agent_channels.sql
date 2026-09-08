-- ════════════════════════════════════════════════════════════════════
-- LifeOS AI — Messaging channels (Telegram) + agent drafts. Idempotent.
-- ════════════════════════════════════════════════════════════════════

-- ── Where a message came from, and where the reply must go back ──────
-- Existing rows are web-chat rows, which is exactly what the default says.
alter table public.agent_messages
  add column if not exists channel text not null default 'web';
alter table public.agent_messages
  add column if not exists channel_chat_id text;

do $$
begin
  alter table public.agent_messages
    add constraint agent_messages_channel_chk
    check (channel in ('web','telegram'));
exception
  when duplicate_object then null;
end $$;

-- ── Linked messaging accounts ────────────────────────────────────────
-- A chat can only talk to the agent once the owner has claimed it with a
-- one-time code. Without this, anyone who finds the bot would be talking to
-- someone else's second brain.
create table if not exists public.agent_channels (
  id           uuid primary key default gen_random_uuid(),
  user_key     text not null,
  provider     text not null check (provider in ('telegram')),
  -- Null until the code is redeemed; set to the chat that redeemed it.
  chat_id      text,
  -- Short-lived pairing code shown once in /agent.
  link_code    text,
  link_expires timestamptz,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- One live link per provider per user, and a chat can only ever map to one
-- user — the partial index lets unredeemed (null chat_id) rows coexist.
create unique index if not exists agent_channels_user_provider_idx
  on public.agent_channels (user_key, provider);
create unique index if not exists agent_channels_chat_idx
  on public.agent_channels (provider, chat_id)
  where chat_id is not null;

-- ── Work the agent produced for you to approve ───────────────────────
-- The "real employee" loop: the agent drafts, you approve, LifeOS sends.
-- Drafting is cheap and reversible (tier `low`); sending is not (tier `high`).
create table if not exists public.agent_drafts (
  id           uuid primary key default gen_random_uuid(),
  user_key     text not null,
  kind         text not null check (kind in ('email','campaign','proposal')),
  -- Recipient / audience. Free text: an email address, or an ad audience.
  target       text,
  subject      text,
  body         text not null,
  -- Structured extras (ad budget, channel, UTM, deal id…).
  meta         jsonb,
  status       text not null default 'draft'
                 check (status in ('draft','approved','sent','rejected')),
  run_id       uuid references public.agent_runs(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists agent_drafts_user_idx
  on public.agent_drafts (user_key, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.agent_channels enable row level security;
drop policy if exists agent_channels_owner on public.agent_channels;
create policy agent_channels_owner on public.agent_channels
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);

alter table public.agent_drafts enable row level security;
drop policy if exists agent_drafts_owner on public.agent_drafts;
create policy agent_drafts_owner on public.agent_drafts
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);
