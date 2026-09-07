-- ════════════════════════════════════════════════════════════════════
-- LifeOS AI — Agent messaging + user-chosen autonomy. Idempotent.
-- ════════════════════════════════════════════════════════════════════

-- ── Conversation with the agent ──────────────────────────────────────
create table if not exists public.agent_messages (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  role        text not null check (role in ('user','agent','system')),
  content     text not null,
  -- 'pending' user messages are what the runner claims; agent replies are 'handled'.
  status      text not null default 'handled' check (status in ('pending','claimed','handled','failed')),
  run_id      uuid references public.agent_runs(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists agent_messages_user_idx
  on public.agent_messages (user_key, created_at desc);
-- The runner's claim query: oldest pending first.
create index if not exists agent_messages_pending_idx
  on public.agent_messages (status, created_at)
  where status = 'pending';

-- ── The user's own autonomy choice ───────────────────────────────────
-- `autonomy` stays the effective level. `autonomy_recommended` records what
-- the assessment suggested, so the UI can show when the two diverge.
alter table public.agent_policies
  add column if not exists autonomy_recommended text;
alter table public.agent_policies
  add column if not exists autonomy_chosen_at timestamptz;

update public.agent_policies
   set autonomy_recommended = autonomy
 where autonomy_recommended is null;

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.agent_messages enable row level security;
drop policy if exists agent_messages_owner on public.agent_messages;
create policy agent_messages_owner on public.agent_messages
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);
