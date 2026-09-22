# 16 — One agent, two surfaces

Telegram and the LifeOS in-app chat answered by the same mind, with the same
memory, reading the same data.

---

## The problem this solves

Before: two agents wearing one name.

| | Telegram | LifeOS `/agent` |
| --- | --- | --- |
| Brain | Hermes | the LifeOS runner |
| Model | whatever Hermes uses | Groq, directly |
| Memory | persistent | none |
| Persona | `SOUL.md` | a hardcoded prompt |

Tell Hermes something on Telegram, then ask in the app, and the app knows
nothing about it. Two personalities, two memories, one confused owner.

---

## The fix

Hermes' API server is **OpenAI-compatible**, and the runner already speaks
that protocol — it is how it calls Groq. So the runner stops being a second
brain and becomes a relay: it hands in-app messages to Hermes and posts the
answer back.

```
Telegram ──────────────┐
                       ├──▶ Hermes ──MCP──▶ LifeOS (policy engine, data)
LifeOS /agent ─▶ runner ┘      │
                               └── SOUL.md · memory · skills · cron
```

One persona. One memory. Both surfaces.

---

## Setup

### 1. Turn on Hermes' API server

In `~/.hermes/.env`:

```bash
printf '\nAPI_SERVER_ENABLED=true\nAPI_SERVER_KEY=%s\n' "$(openssl rand -hex 24)" >> ~/.hermes/.env
grep -E '^API_SERVER_(ENABLED|KEY)=' ~/.hermes/.env
```

It binds to `127.0.0.1:8642` — localhost only. Leave it that way.

```bash
hermes gateway start
```

Check it answers:

```bash
curl -s http://127.0.0.1:8642/v1/chat/completions \
  -H "Authorization: Bearer $(grep '^API_SERVER_KEY=' ~/.hermes/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"model":"hermes-agent","messages":[{"role":"user","content":"dis ok"}]}' | head -c 300
```

### 2. Point the runner at Hermes

In `/opt/lifeos-agent/.env`:

```
AGENT_BACKEND=hermes
HERMES_API_URL=http://127.0.0.1:8642/v1
HERMES_API_KEY=<the same API_SERVER_KEY>
```

### 3. Let the container reach the host

Hermes listens on the host's loopback; inside a container that address is the
container itself. Uncomment in `/opt/lifeos-agent/docker-compose.yml`:

```yaml
    network_mode: host
```

This is preferred over binding Hermes to `0.0.0.0`, which on a public VPS puts
an agent API on the open internet, one firewall mistake from disaster. The
container still listens on nothing and keeps every hardening flag.

```bash
sudo docker compose -f /opt/lifeos-agent/docker-compose.yml up -d
sudo docker compose -f /opt/lifeos-agent/docker-compose.yml logs --tail 3
```

Expect:

```
[runner] starting · lifeos=… · brain=Hermes at http://127.0.0.1:8642/v1 (shared with Telegram) · … · autonomous OFF
```

`autonomous OFF` is automatic in this mode — Hermes has its own cron jobs, and
a second scheduler would reach the same conclusions on the same token budget
and file them twice.

### 4. Check both surfaces

Ask on Telegram: *"retiens que ma priorité du mois est X"*. Then in LifeOS →
**Agent**, ask *"quelle est ma priorité du mois ?"*. The same memory answers.

---

## What "enrichment" actually means here

Three distinct mechanisms, worth not confusing:

**Reading your data.** Hermes already has it — `brain_read`, `brain_search`,
`brain_related` and `workspace_read` over MCP. Ask it about your pipeline and
it looks, rather than guessing; ask it about a note and it sees what that note
advances, supports or contradicts, and why.

**Writing back.** When Hermes calls `brain_write`, `brain_link`, `task_write`
or `deal_write`, the result appears in the LifeOS UI. The second brain becomes
shared memory you can *see* and edit, not just an opaque file on a VPS. A
connection it draws arrives marked "Agent — to review": you keep it or remove
it, and a removal is remembered.

**Its own memory.** `SOUL.md` and `~/.hermes/memories/` stay local to Hermes.
That is fine for working style and preferences. Anything you want visible in
the product should go through `brain_write` instead.

A useful habit: tell it *"note ça dans mon second cerveau"* rather than
*"retiens ça"* when the fact belongs to the business rather than to the
conversation.

---

## What does NOT become shared

Verbatim conversation history. The in-app chat sends its own transcript; the
Telegram thread has its own. Hermes' long-term memory spans both, but it will
not remember the exact wording of a Telegram exchange while answering in the
app.

In practice that is the right split — but do not expect to start a sentence on
Telegram and finish it in the browser.

---

## The strategic trap

**This is the right architecture for you and the wrong one for your
customers.**

Hermes runs on *your* VPS. If the LifeOS in-app agent requires a Hermes
install, then every customer needs their own VPS, their own install, their own
model key — which is the onboarding problem you already set aside as too
complex.

So `AGENT_BACKEND` is a switch, not a replacement:

| | `AGENT_BACKEND=model` | `AGENT_BACKEND=hermes` |
| --- | --- | --- |
| Who | customers | you |
| Needs | a model key | a Hermes host |
| Memory | none | persistent |
| Setup | one token | install + gateway + API server |

Keep `model` as the shipped default. Use `hermes` for yourself.

The longer-term answer for customers — hosting the agent yourselves so they
only paste a token — is the thing you deferred. This split is what makes that
decision reversible: the runner already supports both, so whichever way you go
for customers, your own setup does not have to change.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `AGENT_BACKEND=hermes requires HERMES_API_KEY` | key missing; the runner refuses to start rather than 401 on your first message |
| `Hermes rejected the API key (HTTP 401)` | `HERMES_API_KEY` ≠ `API_SERVER_KEY` |
| `Hermes API HTTP 000` / connection refused | `network_mode: host` still commented, or the gateway is stopped |
| In-app chat hangs | `sudo docker compose -f /opt/lifeos-agent/docker-compose.yml logs --tail 20` |
| Telegram works, app does not | the runner is the only difference — check its logs, not Hermes' |
