-- ════════════════════════════════════════════════════════════════════
-- LifeOS AI — Agent layer: assessment, policy, tasks, runs, audit.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── Assessment results (the gate) ─────────────────────────────────────
create table if not exists public.agent_assessments (
  id            uuid primary key default gen_random_uuid(),
  user_key      text not null,
  responses     jsonb not null,      -- item id → 1..5
  domains       jsonb not null,      -- Big Five means
  calibration   jsonb not null,      -- autonomy / risk / comms
  completeness  integer not null default 0,
  valid         boolean not null default false,
  flags         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists agent_assessments_user_idx
  on public.agent_assessments (user_key, created_at desc);

-- ── Effective policy + runtime state ─────────────────────────────────
create table if not exists public.agent_policies (
  user_key            text primary key,
  autonomy            text not null default 'observe',
  daily_budget_cents  integer not null default 0,
  daily_run_limit     integer not null default 0,
  verbosity           text not null default 'detailed',
  cadence             text not null default 'digest',
  degraded            boolean not null default true,
  kill_switch         boolean not null default false,
  runs_today          integer not null default 0,
  spent_today_cents   integer not null default 0,
  usage_date          date not null default current_date,
  updated_at          timestamptz not null default now()
);

-- ── Runner credentials (one revocable token per user) ────────────────
-- Only the SHA-256 hash is stored; the plaintext is shown once at creation.
create table if not exists public.agent_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  token_hash  text not null unique,
  name        text,
  last_used   timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists agent_tokens_user_idx on public.agent_tokens (user_key);

-- ── Tasks the user asks the agent to do ──────────────────────────────
create table if not exists public.agent_tasks (
  id            uuid primary key default gen_random_uuid(),
  user_key      text not null,
  title         text not null,
  instruction   text not null,
  capabilities  text[] not null default '{}',   -- requested capability ids
  status        text not null default 'queued', -- queued|running|awaiting_approval|done|failed|cancelled
  schedule      text,                            -- null = one-shot, else cron
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists agent_tasks_user_idx on public.agent_tasks (user_key, created_at desc);
create index if not exists agent_tasks_claim_idx on public.agent_tasks (status, created_at);

-- ── One execution of a task ──────────────────────────────────────────
create table if not exists public.agent_runs (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.agent_tasks(id) on delete cascade,
  user_key     text not null,
  status       text not null default 'running',  -- running|done|failed|denied
  summary      text,
  cost_cents   integer not null default 0,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists agent_runs_user_idx on public.agent_runs (user_key, started_at desc);

-- ── Every decision the policy engine made (append-only audit) ────────
create table if not exists public.agent_audit (
  id            uuid primary key default gen_random_uuid(),
  user_key      text not null,
  run_id        uuid references public.agent_runs(id) on delete cascade,
  capability    text not null,
  decision      text not null,        -- allow|approve|deny
  reason        text not null,
  payload       jsonb,                -- what the agent wanted to do
  approved_by   text,                 -- set when a human approved
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists agent_audit_user_idx on public.agent_audit (user_key, created_at desc);
create index if not exists agent_audit_pending_idx on public.agent_audit (user_key, decision, approved_at);

-- ════════════════════════════════════════════════════════════════════
-- Row-Level Security — owner-only, enforced once requests carry a JWT.
-- ════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'agent_assessments','agent_policies','agent_tokens',
    'agent_tasks','agent_runs','agent_audit'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all
         using (user_key = auth.uid()::text)
         with check (user_key = auth.uid()::text)',
      t || '_owner', t
    );
  end loop;
end $$;

-- The audit log must not be rewritable, even by its owner.
drop policy if exists agent_audit_owner on public.agent_audit;
create policy agent_audit_read on public.agent_audit
  for select using (user_key = auth.uid()::text);
create policy agent_audit_append on public.agent_audit
  for insert with check (user_key = auth.uid()::text);
