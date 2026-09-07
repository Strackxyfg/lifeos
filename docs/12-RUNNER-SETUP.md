# Running the agent on a VPS — setup guide

The runner is deliberately powerless: it holds **no** database, Notion, Supabase
or payment credentials. Only a scoped, revocable LifeOS token and a model API
key. It proposes; LifeOS decides and acts.

---

## ⚠️ Read this first: LifeOS must be publicly reachable

The runner lives on a VPS. It calls `LIFEOS_URL` over the network. Your LifeOS
currently runs on `http://localhost:3000` — **a VPS cannot reach your laptop.**

So there is an ordering constraint: **deploy LifeOS before the runner.**

| Situation | What to do |
|---|---|
| Just want to test today | Temporary tunnel (below) — 2 minutes |
| Real setup | Deploy LifeOS to Vercel (free), then the runner |

### Option A — Deploy LifeOS to Vercel (recommended)

```bash
npm i -g vercel && vercel --prod
```

Copy every variable from `.env.local` into Vercel → Project → Settings →
Environment Variables, then set `NEXT_PUBLIC_APP_URL` to the deployed URL and
redeploy. Your `LIFEOS_URL` is that address.

### Option B — Temporary tunnel (testing only)

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints a public `https://…trycloudflare.com` URL — use it as `LIFEOS_URL`.
It dies when you close the terminal, and your laptop must stay on. Fine for a
first end-to-end test, not for real use.

---

## 1. Pick a VPS

The runner idles at ~40 MB RAM. Anything works.

| Host | Cost | Notes |
|---|---|---|
| **Oracle Cloud Always Free** | **$0** | 4 ARM cores / 24 GB RAM, genuinely free. Sign-up can be fussy. |
| **Hetzner CX22** | ~€3.8/mo | Best price/performance, EU data residency. |
| **Fly.io** | ~$2/mo | `fly launch` from `agent-runner/`, scales to zero. |
| **Contabo / Netcup** | ~€4/mo | Cheap, generous specs. |

Debian 12 or Ubuntu 24.04.

## 2. Mint the token

LifeOS → **Agent** → **Generate token**. Copy it immediately — it is shown once
and only its SHA-256 hash is stored. Revoking it in the UI stops the runner
instantly, wherever it is running.

## 3. Install

Copy the `agent-runner/` folder to the server and run:

```bash
sudo bash install.sh
```

It installs Docker if missing, asks for the three values, writes an
owner-only `.env`, and starts the container with `restart: unless-stopped`
(so it survives reboots).

The script refuses a `localhost` URL rather than letting you discover the
mistake through silence.

## 4. Verify

```bash
docker compose -f /opt/lifeos-agent/docker-compose.yml logs -f
```

Expected:

```
[runner] starting · lifeos=https://… · model=llama-3.3-70b-versatile · poll=30000ms
[runner] message: <your message>
[runner] replied to 4f2a1c9b
```

Then in LifeOS → **Agent**, send a message. It shows *"waiting for your
runner…"* and the reply appears within one poll cycle (~30 s).

Container health is a real probe: the runner touches a heartbeat file each
cycle, and the healthcheck fails if it goes stale for three cycles.

```bash
docker inspect --format '{{.State.Health.Status}}' lifeos-agent-agent-1
```

---

## Security posture

What the container gets: read-only filesystem, `no-new-privileges`, **all** Linux
capabilities dropped, non-root UID 1000, 256 MB / 0.5 CPU / 128 PIDs, log
rotation.

What it can reach: `LIFEOS_URL` and the model endpoint. Nothing else.

What it can do on its own: **nothing.** Every action goes through
`POST /api/agent/v1/act`, which runs the policy engine and — when allowed —
performs the effect *inside LifeOS*. A fully compromised runner can propose
things and be refused.

Three independent stops, in order of bluntness:

1. **Kill switch** (LifeOS → Agent) — refuses everything, including reads.
2. **Revoke token** — the runner gets 401 on its next call.
3. `docker compose down` on the VPS.

## Cost

Groq's free tier (30 req/min, 14 400/day) covers a 30-second poll with a wide
margin. With a free Oracle VPS the whole thing runs at **$0/month**; on Hetzner,
about **€4/month**.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `missing required env var LIFEOS_URL` | `.env` absent or unreadable — check `/opt/lifeos-agent/.env` |
| `HTTP 401` on every call | Token revoked or mistyped; mint a new one |
| `HTTP 404` on `/api/agent/v1/...` | `LIFEOS_URL` points somewhere that isn't LifeOS, or LifeOS isn't deployed yet |
| Messages stay "waiting" | Runner not running, or pointed at the wrong URL — check its logs |
| `relation "agent_messages" does not exist` | Apply `supabase/migrations/005_agent_chat.sql` |
| Container `unhealthy` | The loop is wedged — read the logs; it restarts on its own |
