# 15 — Hermes Agent as the primary agent

Hermes becomes the thing you actually talk to. It brings the messaging
gateway, persistent memory, cron and model routing. LifeOS keeps the policy
engine, the audit log, the kill switch and every credential. They meet over
MCP.

**What Hermes holds:** one scoped, revocable LifeOS token. No database
credentials, no Notion token, no Supabase key, no mail key. If the VPS is
compromised, revoke the token in **Agent → Runner credentials** and it is
inert.

> Commands below are from the official Hermes docs and README, linked at the
> bottom. I could not run them against your VPS, so treat the Hermes-side
> steps as verified-from-documentation rather than verified-in-place. The
> LifeOS side (the MCP endpoint, the token, the guardrails) is tested.

---

## 0. Before you start: the model budget

Your Groq key is at its **daily** ceiling right now:

```
tokens per day (TPD): Limit 200000, Used 199564
```

That is what the old runner's 30-second autonomous pass consumed (~2,880 model
calls a day; the current one makes ~96). **Pointing Hermes at the same Groq key
today will hit the same wall.** Either wait for the daily reset, or give Hermes
its own provider — which is the better arrangement anyway, since Hermes and the
runner should not compete for one budget.

---

## 1. Install

```bash
sudo apt update && sudo apt install -y curl xz-utils
```

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

```bash
source ~/.bashrc
```

Python and Node are handled by the installer. Check it landed:

```bash
hermes doctor
```

> Run this as your normal `ubuntu` user, **not** as root. Hermes keeps its
> config in `~/.hermes/`, and installing as root puts it somewhere your user
> cannot reach.

---

## 2. Give it a model

Interactive picker:

```bash
hermes model
```

Or set a provider key directly — this is the documented example:

```bash
hermes config set OPENROUTER_API_KEY your_key
```

OpenRouter is the pragmatic choice here: it has free models, and it keeps
Hermes off the Groq budget the LifeOS runner is already using.

Nous' own hosted option, which also switches on their tool gateway:

```bash
hermes setup --portal
```

---

## 3. Connect LifeOS

Mint a token in LifeOS → **Agent** → **Runner credentials** → *Generate token*.
It is shown once.

> Generating a new token **revokes the previous one**. If your LifeOS runner is
> still using the old token it will start returning 401 — either give the
> runner the new token too, or keep the old one and mint a separate token for
> Hermes.

Edit `~/.hermes/config.yaml` and add:

```yaml
mcp_servers:
  lifeos:
    url: "https://lifeos-mu-taupe.vercel.app/api/agent/mcp"
    headers:
      Authorization: "Bearer lifeos_agent_YOURTOKEN"
```

Transport defaults to Streamable HTTP, which is what the LifeOS endpoint
speaks — do not set `transport: sse`.

There is also an interactive `hermes mcp add`, which connects, discovers the
tools and writes the config for you.

Reload tools inside a Hermes session:

```
/reload-mcp
```

Check the endpoint independently first, before blaming Hermes for anything:

```bash
curl -s https://lifeos-mu-taupe.vercel.app/api/agent/mcp \
  -H "Authorization: Bearer lifeos_agent_YOURTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 300
```

You should see a JSON list beginning with `brain_read`. A `401` means the
token is wrong or revoked.

You get **18 tools** — every capability except the forbidden ones, which are
not advertised at all. Calls still pass the policy engine: high-risk tools
answer *"queued for approval"* rather than executing.

---

## 4. Telegram

```bash
hermes gateway setup
```

An arrow-key wizard; pick Telegram and give it your bot token from @BotFather.
Then:

```bash
hermes gateway start
```

Hermes denies every user not on an allowlist by default. Set yours:

```bash
hermes config set TELEGRAM_ALLOWED_USERS your_numeric_id
```

**Use one Telegram path, not both.** If Hermes owns Telegram, do *not* also
register the LifeOS webhook from `docs/14-AGENT-CHANNELS.md` on the same bot —
two systems would fight over the same updates. The LifeOS webhook stays there
for anyone not running Hermes. If you already registered it and are switching:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
```

---

## 5. Keep it running

A user service stops when you log out unless lingering is enabled:

```bash
sudo loginctl enable-linger ubuntu
```

The docs point at the Messaging Gateway section for full service setup rather
than publishing a unit file, so check `hermes gateway --help` for a supported
service command before hand-writing one.

---

## 6. Stop paying for two brains

With Hermes doing the thinking, the LifeOS runner should stop doing its own —
otherwise both call a model on the same daily budget to reach the same
conclusions.

Edit `/opt/lifeos-agent/.env`:

```
AUTONOMOUS_MS=0
```

Then:

```bash
sudo docker compose -f /opt/lifeos-agent/docker-compose.yml up -d
```

Confirm:

```bash
sudo docker compose -f /opt/lifeos-agent/docker-compose.yml logs --tail 2
```

```
[runner] starting · … · autonomous OFF (Hermes is the agent; this process only answers in-app chat)
```

### Why keep the runner at all?

Only to answer the chat box in LifeOS → **Agent**. Nothing else claims that
inbox, so stopping the container entirely leaves in-app messages unanswered
forever. It costs a model call only when you type there.

If you never use the in-app chat, stop it completely:

```bash
sudo docker compose -f /opt/lifeos-agent/docker-compose.yml down
```

### Division of labour

| | Hermes | LifeOS |
| --- | --- | --- |
| Conversation, memory, cron | ✅ | — |
| Telegram / WhatsApp / Signal | ✅ | — |
| Model routing | ✅ | — |
| Policy engine, approvals, kill switch | — | ✅ |
| Audit log | — | ✅ |
| Every credential | — | ✅ |
| Executing capabilities | — | ✅ |

Hermes proposes; LifeOS decides and performs. That boundary is what makes
handing Hermes your second brain safe.

---

## Sources

- [Installation — Hermes Agent docs](https://hermes-agent.nousresearch.com/docs/getting-started/installation)
- [MCP config reference](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference/)
- [MCP integration](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)
- [Messaging gateway](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/)
- [NousResearch/hermes-agent on GitHub](https://github.com/nousresearch/hermes-agent)
