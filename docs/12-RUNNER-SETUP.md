# Running the agent on a server

The agent runs on a server of yours (a VPS), never on your own computer. It
holds two secrets, typed on that server and kept in an owner-only file: a
scoped, revocable LifeOS token and a model API key. **No** database, Notion,
Supabase or payment credential ever reaches it. It proposes; LifeOS decides
and acts.

The short version is in the app: **LifeOS → Agent → Install on a server**. It
walks through the steps below and turns green the moment LifeOS hears the
agent.

---

## Before you start: LifeOS must be reachable from the internet

The agent calls LifeOS over the network. A LifeOS running on
`http://localhost:3000` cannot be reached from a server, and the guide says so
when you open it from such an address. Deploy LifeOS first
([`13-DEPLOY.md`](13-DEPLOY.md)), then open the guide from its public address:
the command it shows carries that address.

For a throwaway end-to-end test only, a tunnel works
(`cloudflared tunnel --url http://localhost:3000`) — it dies with your
terminal and your computer must stay on.

## 1. A server

A VPS with **Ubuntu 24.04 or Debian 12**, 1 GB of memory (the agent itself
uses about 40 MB; Docker needs room to build its small image). Hetzner,
OVHcloud, Scaleway, Hostinger or Oracle Cloud's Always Free AMD micro shape
all fit — [`13-DEPLOY.md`](13-DEPLOY.md) walks through two of them. Connect
with SSH (`ssh root@<address>`, or `ubuntu@` on Oracle).

## 2. A model key

The agent thinks with an OpenAI-compatible model. Groq has a free tier with no
card: create a key at <https://console.groq.com/keys>. Mistral (EU-hosted) and
OpenRouter work too, as does any OpenAI-compatible endpoint. The key stays on
the server.

## 3. The token and the command

In the guide, **Generate token** — copy it now, it is shown once and only its
SHA-256 hash is stored. Then, on the server:

```bash
curl -fsSL "https://<your LifeOS>/api/agent/runner/install.sh?lang=fr" | sudo bash
```

(The guide shows the exact line, with your address; `?lang=fr` makes the
installer speak French.)

Nothing secret is in that line. The installer asks for the token and the model
key (hidden as you paste), and **checks everything before changing anything**:

| Step | What it checks |
|---|---|
| 1 · This server | system, processor, memory, disk, `curl` |
| 2 · LifeOS | the address answers *and is a LifeOS with the agent* (not a 404 page), then that the token is accepted |
| 3 · The model | one tiny call in JSON mode — the same kind the agent makes — so a refused key (401/403), an unpaid account (402), an unknown model (404) or a model without JSON mode (400) is caught now, not on your first message |
| 4 · Docker | installs it from get.docker.com if missing, with Compose |
| 5 · The agent | downloads its files from your LifeOS and checks each against `manifest.json`, writes `/opt/lifeos-agent/.env` (mode 600), starts the container, and **waits until LifeOS hears it** |

If a check fails, it says why and what to do, and nothing has been changed. The
secrets never appear on a command line (they go to `curl` through a
root-only config file), so they are not visible to other users of the server
or kept in your shell's history.

## 4. The check

The guide in LifeOS watches for the agent's first call (every 4 seconds) and
turns green: *Connected · heard a few seconds ago*. Send it a message in
**Messages**; the reply usually lands in 3–5 seconds.

---

## Looking after it

The installer leaves a command on the server:

| Command | What it does |
|---|---|
| `lifeos-agent status` | Is the container running, does LifeOS hear it, its last lines |
| `lifeos-agent logs` | What it is doing, live |
| `lifeos-agent update` | The latest agent from your LifeOS: download, check, rebuild, wait until heard |
| `lifeos-agent token` | After **Generate token** in LifeOS (a new token revokes the old one) |
| `lifeos-agent config` | Another model provider, model or key |
| `lifeos-agent doctor` | Every check, changing nothing |
| `lifeos-agent restart` · `stop` · `start` | — |
| `lifeos-agent uninstall` | Stops it, removes `/opt/lifeos-agent` and the command (Docker stays) |

Updating no longer needs a copy of the repository on the server: the agent's
files come from your LifeOS, which serves the version it was deployed with.
(Running `sudo bash install.sh` from a clone's `agent-runner/` folder still
works, and installs from that folder.)

Without a terminal (cloud-init, automation), pass the answers as variables:

```bash
curl -fsSL "https://<your LifeOS>/api/agent/runner/install.sh" | \
  sudo LIFEOS_AGENT_TOKEN=… MODEL_API_KEY=… bash -s -- install --yes
```

## Security posture

What the container gets: a read-only filesystem, `no-new-privileges`, **all**
Linux capabilities dropped, non-root UID 1000, 256 MB / 0.5 CPU / 128 PIDs,
log rotation. It listens on nothing: every connection is outbound, to your
LifeOS and to the model.

What it can do on its own: **nothing**. Every action goes through
`POST /api/agent/v1/act`, which runs the policy engine and — when allowed —
performs the effect *inside LifeOS*. A fully compromised agent can propose
things and be refused.

Three independent stops, in order of bluntness:

1. **Kill switch** (LifeOS → Agent) — refuses everything, including reads.
2. **Revoke** (LifeOS → Agent → Install on a server) — the agent gets 401 on
   its next call; it then waits a minute between tries and logs what to do.
3. `lifeos-agent stop` on the server.

What "connected" means: LifeOS stamps the token's last use on every call the
agent makes (an idle agent calls every 10 seconds); *connected* is a call in
the last 90 seconds. It is what LifeOS saw, never what the agent claims. The
installer's own checks (`/api/agent/v1/ping`) read the token without stamping
it, so the page never turns green before the agent is actually running.

## Troubleshooting

`lifeos-agent doctor` runs every check and says which one fails. The usual
causes:

| What you see | Cause |
|---|---|
| "answers, but it is not a LifeOS with the agent" | The address is not your LifeOS (or an old deployment without the agent) |
| "has no database configured" | Supabase is not set up on that LifeOS |
| "LifeOS refuses this token" | Revoked, or a newer one was generated: `lifeos-agent token` |
| "The provider refused this key" | Mistyped or revoked model key: `lifeos-agent config` |
| "does not serve the model" | Model name retired or misspelled: `lifeos-agent config` |
| The guide stays on *waiting* | The container stopped: `lifeos-agent status`, then `logs` |
| *Silent for …* in LifeOS | The server is off, or the agent stopped: `lifeos-agent status` |
| `relation "agent_messages" does not exist` | Apply `supabase/migrations/005_agent_chat.sql` |

## Running Hermes as the brain

For the owner who runs Hermes on the same server (one agent across the app
and Telegram), see [`15-HERMES.md`](15-HERMES.md) and
[`16-ONE-AGENT-TWO-SURFACES.md`](16-ONE-AGENT-TWO-SURFACES.md). The installer
keeps any `AGENT_BACKEND`/`HERMES_*` lines already in `.env`. A new token
revokes the one Hermes uses too: give it the new one as well.
