# 14 — Talking to your agent, and what it can do

Three things changed: the agent is reachable from Telegram, it answers in
seconds instead of half a minute, and it can now do a day's work — writing
emails, campaigns and proposals — without being able to send any of it
without you.

---

## 0. Apply migration 006 first

Everything here needs it. Supabase → **SQL Editor** → paste
`supabase/migrations/006_agent_channels.sql` → **Run**. It is idempotent, so
running it twice is safe.

Until you do, LifeOS degrades rather than breaks: the console renders, chat
still works, and drafting reports an honest error instead of pretending.

---

## 1. Telegram

### Create the bot (2 minutes)

1. Open Telegram, message **@BotFather**, send `/newbot`.
2. Give it a name and a username. BotFather replies with a token like
   `8123456789:AAH...`.
3. Generate a webhook secret:

```bash
openssl rand -hex 32
```

### Set the environment variables

In Vercel → your project → **Settings → Environment Variables**:

| Variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | the random hex string you just generated |
| `TELEGRAM_BOT_USERNAME` | the bot's username, without the `@` |

Redeploy so they take effect.

### Point Telegram at LifeOS

Run this once, substituting your values:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://lifeos-mu-taupe.vercel.app/api/agent/telegram/webhook","secret_token":"<TELEGRAM_WEBHOOK_SECRET>","allowed_updates":["message"]}'
```

Expect `{"ok":true,"result":true,...}`. Check it any time with:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

### Pair your chat

LifeOS → **Agent** → **Telegram** → *Generate pairing code*, then send the
`/start XXXXXXXX` line it gives you to your bot. The code expires in 15
minutes and works once.

**Why the pairing step exists.** Anyone can find a Telegram bot. Without a
claim step, a stranger messaging your bot would be talking to your second
brain. Two independent checks stand in the way: the secret token proves the
request really came from Telegram, and the pairing proves the chat belongs to
you. An unlinked chat gets instructions and nothing else.

To revoke a phone you no longer have: **Unlink**, or just generate a new code —
issuing one unlinks the previous chat.

---

## 2. Why it replies faster now

The runner used to sleep 30 seconds between cycles, and each cycle spent two
network round-trips loading context before it even checked whether anyone had
written. A message sent one second after a poll waited ~35 seconds for a reply.

Three changes:

| Change | Effect |
| --- | --- |
| **Adaptive polling** — ~1.5 s while a conversation is live, 10 s when idle | removes ~15 s of average dead time |
| **Inbox checked first**, and it now carries the kill-switch state | removes two round-trips per idle cycle |
| **Context cached 60 s**; the autonomous pass moved to its own 15-minute clock | removes a gate call + fetch from the reply path |

Typical reply is now **≈3–5 seconds**, most of which is the model thinking.

The autonomous pass moving off the poll loop also fixes the quota exhaustion
you hit: it was proposing a `brain.write` every 30 seconds and burning all 50
daily runs in half an hour. It now runs 4 times an hour.

Tune on the VPS in `/opt/lifeos-agent/.env`:

```
POLL_MS=10000        # idle cadence
HOT_POLL_MS=1500     # while a conversation is live
AUTONOMOUS_MS=900000 # background work, 15 min
```

---

## 3. What the agent can do now

The catalogue gained a deliberate split. **Drafting is cheap and reversible,
so the agent may do it unsupervised. Sending is not, so it stops for you.**

| Capability | Tier | Behaviour |
| --- | --- | --- |
| `deal.write` | low | updates your pipeline |
| `email.draft` | low | writes the full email — nothing leaves LifeOS |
| `campaign.draft` | low | ad copy, targeting, and a budget request |
| `proposal.draft` | low | a complete sales proposal |
| `web.research` | medium | reads public pages |
| `email.send` | **high** | always needs your approval |
| `ads.launch` | **high** | always needs your approval, per campaign |
| `payment` | **forbidden** | never |
| `contract.sign` | **forbidden** | never |

Finished drafts appear in **Agent → Waiting for you**. Approving an email
sends it; approving a campaign marks it ready.

### Two judgement calls you should know I made

**Ad spend is now possible, narrowly.** You asked for an agent that runs ad
campaigns. `payment` was — and stays — `forbidden`, so I did not simply
unlock it. Instead `ads.launch` is a separate `high` capability: approved
campaign by campaign, against a connected ad account, under the daily budget
ceiling. Open-ended money movement is still never delegable. If you would
rather it were fully automatic, that is your call to make, but it should be a
deliberate one rather than a side effect.

**"Close sales on its own" has a hard limit.** The agent can find prospects,
research them, write the outreach, handle the back-and-forth and produce the
proposal. It cannot agree terms or sign — `contract.sign` is `forbidden`.
Only a person can bind you to a contract, and an agent that could would be a
liability rather than an employee.

Also worth knowing before you point this at cold outreach: under GDPR and
ePrivacy, unsolicited B2C email in the EU needs consent, B2B is narrower than
most people assume, and volume from a new domain will land you in spam
regardless of the law. Warm the domain, keep volumes low, and honour
unsubscribes. The drafting/approval split is genuinely useful here — you see
every message before it goes.

### Enabling sending

Sending needs a provider. Without one the agent still drafts, and says
plainly that it cannot send rather than reporting a success:

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | from resend.com |
| `AGENT_FROM_EMAIL` | an address on a domain you have verified there |

---

## 4. Hermes Agent

The market study in `docs/11-AGENT.md` chose Hermes Agent and then a bespoke
runner got built instead. This closes that gap without throwing away the
guardrails.

Hermes brings what it is genuinely good at — the messaging gateway, persistent
memory, cron, model routing, container isolation. LifeOS keeps what must not
move: the policy engine, the audit log, the kill switch, and every credential.
They meet over **MCP**.

LifeOS now serves an MCP endpoint at:

```
https://lifeos-mu-taupe.vercel.app/api/agent/mcp
```

Authenticated with the same scoped, revocable runner token from
**Agent → Runner credentials**. It publishes 18 tools — every capability
except the forbidden ones, which are not advertised at all — and each call
lands on the same gate as the REST runner. A `high`-tier tool answers
"queued for approval" rather than executing.

### Point Hermes at it

On the VPS, after installing Hermes:

```bash
hermes mcp add lifeos \
  --transport http \
  --url https://lifeos-mu-taupe.vercel.app/api/agent/mcp \
  --header "Authorization: Bearer lifeos_agent_YOURTOKEN"
```

Then configure messaging with `hermes gateway setup` and reload tools with
`/reload-mcp`. Hermes's own allowlist (`TELEGRAM_ALLOWED_USERS`) is separate
from LifeOS pairing — set both.

Verify the endpoint independently at any time:

```bash
curl -s https://lifeos-mu-taupe.vercel.app/api/agent/mcp \
  -H "Authorization: Bearer lifeos_agent_YOURTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 400
```

**The security property that makes this safe:** Hermes holds one bearer token
and nothing else. No database credentials, no Notion token, no mail key, no
Supabase key. If the VPS is compromised, the attacker gets a revocable token
whose every use is gated and logged — revoke it in **Agent → Runner
credentials** and it is inert.

### Which runner should you use?

Both speak to the same gate, so this is reversible.

- **Keep the LifeOS runner** if you want the smallest thing that works. It is
  ~250 lines, you can read all of it, and Telegram already works through
  LifeOS's own webhook — no Hermes needed.
- **Switch to Hermes** when you want WhatsApp/Signal/Discord/SMS as well,
  scheduled automations, and persistent memory across conversations without
  building them.

Running both at once is safe — the inbox claim prevents double-answering —
but pointless. Pick one.
