# Deploy: GitHub → Vercel → VPS runner

Follow in order. The runner cannot work until LifeOS is publicly reachable.

---

# Step 1 — Push to GitHub

The repository is committed locally on branch `main` (183 files, no secrets —
`.env.local`, `.data/` and `agent-runner/.env` are all gitignored).

Create an **empty private** repo at <https://github.com/new> — no README, no
`.gitignore`, no licence — then:

```bash
git remote add origin https://github.com/<your-username>/lifeos.git
git push -u origin main
```

> **Keep it private.** Nothing secret is committed, but the repo describes your
> whole security model. Make it public later if you want.

### Verify before pushing

```bash
git ls-files | grep -E "\.env$|\.env\.local|^\.data/"
```

Empty output = safe. If anything appears, **stop** and tell me.

---

# Step 2 — Deploy to Vercel

1. <https://vercel.com/new> → **Import Git Repository** → pick your repo.
2. Framework preset: **Next.js** (auto-detected). Don't change build settings.
3. **Before clicking Deploy**, add the environment variables below.

### Environment variables

Copy each value from your local `.env.local`. Set them for **Production,
Preview and Development**.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | from `.env.local` |
| `AI_PROVIDER` | `groq` |
| `GROQ_API_KEY` | from `.env.local` |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` |
| `NOTION_CLIENT_ID` | from `.env.local` |
| `NOTION_CLIENT_SECRET` | from `.env.local` |
| `NEXT_PUBLIC_APP_URL` | ⚠️ see below |
| `NOTION_REDIRECT_URI` | ⚠️ see below |

The last two need the deployed URL, which you don't know yet. Deploy once with
placeholders, note the URL Vercel gives you (e.g.
`https://lifeos-xyz.vercel.app`), then set:

```
NEXT_PUBLIC_APP_URL  = https://lifeos-xyz.vercel.app
NOTION_REDIRECT_URI  = https://lifeos-xyz.vercel.app/api/integrations/notion/callback
```

…and **redeploy** (Deployments → ⋯ → Redeploy).

### ⚠️ Do NOT set `NOTION_TOKEN` in production

A global `NOTION_TOKEN` makes *every* user count as "already connected", which
skips the OAuth step and would build into **your** workspace. Leave it unset so
each user connects their own Notion.

### Three settings that are easy to forget

**a) Notion** — <https://notion.so/my-integrations> → your integration → OAuth
Domain & URIs → add the production redirect URI (exactly as above).

**b) Supabase Auth** — Dashboard → Authentication → URL Configuration:
- Site URL: `https://lifeos-xyz.vercel.app`
- Redirect URLs: add `https://lifeos-xyz.vercel.app/**`

Without this, sign-in redirects back to `localhost` and fails.

**c) Migrations** — SQL editor, in order, if not already applied:
`schema.sql` → `002_workspace_data.sql` → `003_notion_oauth.sql` →
`004_agent.sql` → `005_agent_chat.sql`.

`005` is the one messaging and the autonomy picker need.

### Check it works

Open the URL, sign in, visit `/agent`. If the page loads, LifeOS is live.

---

# Step 3 — Open the guide in LifeOS

LifeOS → **Agent** → **Install on a server**. Open it from the deployed
address (not `localhost`): the command it shows carries that address. Keep the
page open; it turns green when your server's agent calls in.

You will need a model key — Groq's free tier is the simplest:
<https://console.groq.com/keys>.

---

# Step 4A — Hostinger VPS (simplest)

**KVM 1**: 1 vCPU / 4 GB / 50 GB NVMe. The agent idles at ~40 MB, so this is
generous.

1. **Buy** — hostinger.com → VPS Hosting → **KVM 1**. Pick the datacentre
   closest to you.
2. **OS template** — **Ubuntu 24.04** (the variant with Docker saves a minute;
   the installer adds Docker otherwise).
3. **Root password / SSH key** — set one when prompted, and note the server's
   IP from hPanel → VPS → Overview.
4. **Connect**: `ssh root@<your-vps-ip>`
5. In the guide, **Generate token**, then paste the guide's command on the
   server:

```bash
curl -fsSL "https://<your LifeOS>/api/agent/runner/install.sh?lang=fr" | sudo bash
```

6. Paste the token, choose the model provider (Enter for Groq), paste the key.
   Everything is checked before anything is installed; then it starts the agent
   and waits until LifeOS hears it.

No git clone, no repository access needed on the server: the agent's files
come from your LifeOS.

---

# Step 4B — Oracle Cloud Always Free ($0/mo)

Genuinely free forever, but the sign-up is fussier. **The critical trick is in
step 4.**

1. **Sign up** — <https://signup.cloud.oracle.com>. A card is required for
   identity verification; Always Free resources are not charged. Choose your
   **home region carefully — it cannot be changed** and determines capacity.
   Frankfurt and Singapore provision reliably.

2. **Wait** for the "Your account is ready" email (minutes to a few hours).

3. **Create the instance** — Console → ☰ → Compute → Instances →
   **Create instance**.

4. **⚠️ Choose the AMD shape, not ARM.**

   Click **Edit** next to *Image and shape* → **Change shape** → **AMD** →
   `VM.Standard.E2.1.Micro` (1 OCPU, 1 GB) — marked *Always Free-eligible*.

   **Why not ARM?** The Ampere A1 shape is the famous one, but Oracle
   [halved it in 2026](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)
   to 2 OCPU / 12 GB and it is frequently **"Out of host capacity"** — people
   retry for days. The AMD micro is almost always available, and 1 GB is
   ~25× what this agent needs. Take the boring shape.

5. **Image** — Canonical Ubuntu 24.04.

6. **SSH key** — *Add SSH keys* → **Generate a key pair** → **download the
   private key** (you cannot retrieve it later). Or paste your own public key.

7. **Create**, then copy the **Public IP address** from the instance page.

8. **Connect** (note: user is `ubuntu`, not `root`):

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<public-ip>
```

9. **Install** — the guide's command, as on Hostinger (`sudo` is already in it).

> **Oracle note:** the agent only makes *outbound* connections, so you do
> **not** need to open any ingress port or touch the security list. If you ever
> do expose a port, Oracle's Ubuntu images also have local `iptables` rules that
> must be changed separately from the cloud security list — a classic trap.

---

# Step 5 — Verify end to end

1. The guide in LifeOS shows **Connected · heard a few seconds ago**.
2. LifeOS → **Agent** → **Messages** → send a message; the reply usually lands
   in 3–5 seconds.
3. On the server, `lifeos-agent status` shows the container, its health, when
   LifeOS last heard it, and its last lines.

## If something is wrong

`lifeos-agent doctor` runs every check without changing anything. See the
table in [`12-RUNNER-SETUP.md`](12-RUNNER-SETUP.md#troubleshooting). Two that
belong to the deployment itself:

| Symptom | Cause |
|---|---|
| Vercel build fails | Check the build log; run `npm run build` locally to reproduce |
| Sign-in bounces to localhost | Supabase Auth URL Configuration (step 2b) |
| Notion OAuth `redirect_uri_mismatch` | The URI in Notion ≠ `NOTION_REDIRECT_URI` |

## Cost

| | |
|---|---|
| Vercel Hobby | $0 |
| Supabase Free | $0 |
| Groq free tier | $0 (an idle agent makes no model calls; replies and the 15-minute background pass do) |
| Oracle AMD micro | **$0** |
| *or* Hostinger KVM 1 | ~$5/mo |

**Sources:** [Oracle free-tier reduction (InfoQ)](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/) · [Hostinger VPS pricing](https://smarthostfinder.com/hostinger-vps-pricing/)
