# Autonomous Agent — market study, architecture, guardrails

> Researched July 2026. **Free tiers and prices move fast — re-verify before committing.**

## 1. Market study

### 1.1 Agent runtime

| Option | Licence | Fit for "runs off my machine, does my tasks" | Verdict |
|---|---|---|---|
| **Hermes Agent** (Nous Research) | MIT | Purpose-built as a headless VPS service. Persistent memory, autonomous skill creation, scheduled automations, messaging gateways, **container isolation + command approval**, provider-agnostic (`hermes model` switches with no code change). Runs on a $5 VPS. | ✅ **Chosen** |
| OpenClaw | Open source | Node.js gateway fanning out to 50+ messaging channels. Excellent reach, but the centre of gravity is chat routing, not governed task execution. | Strong runner-up |
| Dify | Open source | Full LLM platform with visual workflows and a Celery worker. Powerful, but ~4 GB RAM baseline and far more product than we need. | Too heavy |
| CrewAI / LangGraph / PydanticAI | Open source | Libraries, not runtimes. You still build hosting, scheduling, memory and approvals yourself. | Wrong layer |
| AutoGen | Open source | Moved to maintenance; folded into Microsoft Agent Framework. | Avoid |

Hermes and OpenClaw are the two serious contenders — as of May 2026 Hermes overtook OpenClaw at the top of OpenRouter's global agent rankings (224B vs 186B daily tokens). Hermes wins here on the axes that matter for us: **operational controls and isolation**, plus a real learning loop.

### 1.2 Model provider

| Provider | Free tier | Speed | Notes |
|---|---|---|---|
| **Groq** | 30 RPM · 6k TPM · 14.4k req/day, **no credit card, no per-token charge** | ~394 TPS on Llama 3.3 70B | ✅ **Primary.** Genuinely free, fastest |
| **Cerebras** | 30 RPM · ~1k req/day · 1M tokens/day | Very fast | ✅ **Secondary.** Smaller catalogue |
| **OpenRouter** | 1M free BYOK requests/month, then 5% routing fee | ~80–150 TPS on free routing | ✅ **Fallback.** Widest model choice (28+ incl. DeepSeek R1, Qwen3) |

**Decision: Groq primary → Cerebras on rate-limit → OpenRouter for breadth.** All three are OpenAI-compatible, so switching is two environment variables ([`agent-runner/.env.example`](../agent-runner/.env.example)) — no code change and no lock-in.

### 1.3 Hosting

| Option | Cost | Notes |
|---|---|---|
| **Oracle Cloud Always Free** | **$0** | Cheapest real 24/7 option. Caveat: idle instances get reclaimed — keep a heartbeat |
| **Hetzner CX23** | ~€4.49/mo (2 vCPU, 4 GB) | ✅ **Recommended.** Predictable, no egress surprises |
| Fly.io | ~$8–25/mo realistically | Free tier ended for new accounts |
| Managed platforms | $10–20/mo | Often cheaper once your setup time is priced in |

**Decision: Hetzner CX23, or Oracle Always Free for €0.** Total running cost: **€0–4.50/month.**

## 2. Architecture — why the agent is not on your machine

```
┌────────────────────────┐          ┌──────────────────────────────┐
│  LifeOS (Vercel)       │          │  VPS — Hetzner / Oracle      │
│  CONTROL PLANE         │          │  EXECUTION PLANE             │
│                        │          │                              │
│  • assessment gate     │◄────────►│  Hermes Agent / runner       │
│  • policy engine       │  HTTPS   │  in a hardened container     │
│  • approval queue      │  scoped  │                              │
│  • audit log           │  token   │  holds ONLY:                 │
│  • kill switch         │          │   – scoped LifeOS token      │
│  • Supabase, Notion,   │          │   – a model API key          │
│    Stripe credentials  │          │                              │
└────────────────────────┘          └──────────────────────────────┘
        the secrets live here              never here
```

The runner is **deliberately powerless**. It cannot read the database, cannot
touch Notion, cannot execute anything locally. It can only *propose* actions to
`/api/agent/v1/act`, which runs the policy engine and answers allow / approve /
deny. If the gate is unreachable, the runner **fails closed**.

Container hardening ([`docker-compose.yml`](../agent-runner/docker-compose.yml)):
read-only filesystem, `no-new-privileges`, **all Linux capabilities dropped**,
non-root user, 256 MB / 0.5 CPU / 128 PID caps.

## 3. The gate — assessment before autonomy

[`lib/assessment/instrument.ts`](../lib/assessment/instrument.ts) has two clearly
separated modules, and the UI says which is which:

1. **Mini-IPIP** (Donnellan, Oswald, Baird & Lucas, 2006) — 20 items, public
   domain, from the International Personality Item Pool. Published α ≈ .65–.77,
   convergence r ≈ .85–.93 with the 50-item parent scales.
2. **Operational calibration** — 12 purpose-built items on delegation, risk and
   communication. **Not a validated psychometric scale**, and never presented as
   one. They exist because trait scores don't tell you how much autonomy someone
   actually wants.

Quality controls: an attention check, straight-lining detection (≥90% identical
answers), and a completeness threshold. **A profile that fails any of these is
marked invalid and the agent drops to the minimum policy** — it is never used to
justify more freedom.

> This is a working-style calibration, not a clinical assessment, and must never
> be used to judge a person. IPIP items are public domain; confirm the licensing
> position with counsel before commercial launch.

## 4. Guardrails

**The one rule everything follows from: the assessment can only make the agent
more restrictive, never less.** A personality score must never be able to unlock
sending email or moving money.

| Tier | Examples | Behaviour |
|---|---|---|
| `safe` | read brain, analyse | Always automatic |
| `low` | create tasks, capture notes | Automatic from `act` level |
| `medium` | write to Notion, calendar | Automatic only at `extend` |
| `high` | send email, post to Slack, run code, external HTTP | **Always needs human approval, at every level** |
| `forbidden` | move money, read secrets, delete data, change account settings | **Always denied — no profile, no setting, no override** |

Also enforced ([`lib/agent/policy.ts`](../lib/agent/policy.ts)):

- **Default-deny** — a capability not in the catalogue is refused.
- **Kill switch** — overrides everything, including safe reads.
- **Daily budget** (0–100¢) and **run limit**, so a runaway loop costs cents.
- **Append-only audit** — every decision logged with its reason; RLS grants
  select + insert only, so history cannot be rewritten, even by its owner.
- **Revocable token** — hashed at rest; revoking stops the runner instantly.

Verified by 20 tests in [`tests/agent-policy.test.ts`](../tests/agent-policy.test.ts),
including: forbidden capabilities denied *at maximum autonomy*, high-risk always
gated, nothing above `medium` ever auto-allowed at any level, unknown
capabilities denied, kill switch absolute.

## 5. Autonomy is the owner's choice

The assessment **recommends**; you decide. `/agent` has a four-level picker, and
choosing above the recommendation is allowed — it's your account — but flagged,
and written to the audit log with who changed it and when.

This does **not** weaken anything. The invariant still holds because the hard
rules were never derived from the profile in the first place:

- `high` (email, Slack, external HTTP, code) → **always** needs your approval, at
  every level including `extend`.
- `forbidden` (money, secrets, deletion, account changes) → **always denied**.

What the level actually controls is how much of the `safe`/`low`/`medium` band
runs without asking, plus the daily budget and run ceiling.

## 6. Messaging

`/agent` carries a conversation. Because the agent lives on your VPS, replies
are not instant and the UI says so:

```
you type  → agent_messages (status: pending)
runner    → GET  /api/agent/v1/inbox    claims pending, gets recent history
          → model call (JSON: reply + optional proposed action)
          → POST /api/agent/v1/act      the proposal passes the gate
          → POST /api/agent/v1/inbox    posts the reply, closes the message
UI        → polls while a reply is outstanding, shows "waiting for your runner"
```

Claims expire after 5 minutes, so a crashed runner can't strand a conversation,
and two runners can't answer the same message twice.

## 7. "Allow" now means something

Previously `/act` only returned a verdict. It now **performs the effect itself**,
in LifeOS ([`lib/agent/execute.ts`](../lib/agent/execute.ts)) — the runner still
executes nothing. Wired today: `brain.write`, `task.write`, `project.write`.

Anything approved by policy but not yet built returns `not_implemented` and says
so, rather than reporting a success that never happened. **The agent must never
be able to claim it sent an email that was never sent.**

## 8. Deploying

```bash
# On the VPS
git clone <repo> && cd lifeos/agent-runner
cp .env.example .env      # add LIFEOS_URL, LIFEOS_AGENT_TOKEN, MODEL_API_KEY
docker compose up -d
```

Apply both [`004_agent.sql`](../supabase/migrations/004_agent.sql) and
[`005_agent_chat.sql`](../supabase/migrations/005_agent_chat.sql) first —
messaging and the autonomy picker both need `005`.

## Sources

- [Hermes Agent (GitHub)](https://github.com/nousresearch/hermes-agent)
- [Hermes Agent vs OpenClaw — MarkTechPost](https://www.marktechpost.com/2026/05/10/openclaw-vs-hermes-agent-why-nous-researchs-self-improving-agent-now-leads-openrouters-global-rankings/)
- [Best open-source AI agent frameworks to self-host — Contabo](https://contabo.com/blog/best-open-source-ai-agent-frameworks/)
- [Groq free tier limits 2026 — TokenMix](https://tokenmix.ai/blog/groq-free-tier-limits-2026)
- [Free LLM APIs compared — OpenRouter](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/)
- [Free LLM API tiers 2026 — Ian Paterson](https://ianlpaterson.com/blog/free-llm-api-2026/)
- [Cheap VPS for AI agents — Hermify](https://www.hermify.io/en/blog/cheap-vps-for-ai-agent)
- [Fly.io alternatives after the free tier — ExpressTech](https://expresstech.io/7-fly-io-alternatives-in-2026-real-pricing-after-the-free-tier-died/)
- [Mini-IPIP — Millisecond](https://www.millisecond.com/library/mini_ipip)
- [International Personality Item Pool — Wikipedia](https://en.wikipedia.org/wiki/International_Personality_Item_Pool)
