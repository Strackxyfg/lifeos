#!/usr/bin/env bash
# LifeOS Agent Runner — one-command install on a fresh Debian/Ubuntu VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/lifeos/main/agent-runner/install.sh | bash
#
# or, from a copy of this folder on the server:  sudo bash install.sh
#
# Installs Docker if missing, prompts for the three secrets, and starts the
# runner as a hardened container that survives reboots.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lifeos-agent}"
say() { printf '\033[1;36m›\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (or with sudo)."

# ── Docker ───────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
else
  say "Docker already present."
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."

# ── Files ────────────────────────────────────────────────────────────
mkdir -p "$APP_DIR"
for f in index.mjs Dockerfile docker-compose.yml; do
  [ -f "$f" ] || die "Missing $f — run this from the agent-runner/ folder."
  cp "$f" "$APP_DIR/"
done
cd "$APP_DIR"

# ── Secrets ──────────────────────────────────────────────────────────
if [ -f .env ]; then
  say ".env already exists — keeping it. Delete it to reconfigure."
else
  say "Configuration. Nothing here grants database, Notion or payment access."
  read -rp "  LifeOS public URL (https://…): " LIFEOS_URL
  read -rp "  Agent token (LifeOS → Agent → Generate token): " LIFEOS_AGENT_TOKEN
  read -rp "  Model API key (Groq/Cerebras/OpenRouter): " MODEL_API_KEY
  read -rp "  Model base URL [https://api.groq.com/openai/v1]: " MODEL_BASE_URL
  read -rp "  Model [llama-3.3-70b-versatile]: " MODEL

  case "$LIFEOS_URL" in
    https://*) ;;
    http://localhost*|http://127.*)
      die "A VPS cannot reach your laptop. Deploy LifeOS first (see docs/11-AGENT.md)." ;;
    *) die "LIFEOS_URL must be https:// in production." ;;
  esac
  [ -n "$LIFEOS_AGENT_TOKEN" ] || die "The agent token is required."

  umask 077
  cat > .env <<EOF
LIFEOS_URL=${LIFEOS_URL%/}
LIFEOS_AGENT_TOKEN=$LIFEOS_AGENT_TOKEN
MODEL_API_KEY=$MODEL_API_KEY
MODEL_BASE_URL=${MODEL_BASE_URL:-https://api.groq.com/openai/v1}
MODEL=${MODEL:-llama-3.3-70b-versatile}
POLL_MS=30000
EOF
  chmod 600 .env
  say "Wrote $APP_DIR/.env (owner-only)."
fi

# ── Run ──────────────────────────────────────────────────────────────
say "Building and starting…"
docker compose up -d --build

sleep 6
say "Status:"
docker compose ps
echo
say "Logs:    docker compose -f $APP_DIR/docker-compose.yml logs -f"
say "Stop:    docker compose -f $APP_DIR/docker-compose.yml down"
say "Revoke:  LifeOS → Agent → Revoke  (kills it instantly, wherever it runs)"
