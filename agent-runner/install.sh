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
  say "Answer one prompt at a time — do not paste a multi-line block."

  # `read -u 1` reads from the terminal, not stdin, so this still works when
  # the script itself is piped (curl … | bash) and can't consume the pipe.
  ask() { # ask <var> <prompt>
    local __var=$1 __prompt=$2 __val=""
    while [ -z "$__val" ]; do
      read -r -p "$__prompt" __val </dev/tty || die "No terminal available for input."
      [ -n "$__val" ] || echo "    (required)"
    done
    printf -v "$__var" '%s' "$__val"
  }
  ask_opt() { # ask_opt <var> <prompt> <default>
    local __var=$1 __val=""
    read -r -p "$2" __val </dev/tty || true
    printf -v "$__var" '%s' "${__val:-$3}"
  }

  ask LIFEOS_URL          "  1/4  LifeOS public URL (https://…): "
  ask LIFEOS_AGENT_TOKEN  "  2/4  Agent token (LifeOS → Agent → Generate token): "
  ask MODEL_API_KEY       "  3/4  Model API key (Groq/Cerebras/OpenRouter): "
  ask_opt MODEL_BASE_URL  "  4/4  Model base URL [https://api.groq.com/openai/v1]: " "https://api.groq.com/openai/v1"
  ask_opt MODEL           "       Model [qwen/qwen3.8-27b]: " "qwen/qwen3.8-27b"

  case "$LIFEOS_URL" in
    https://*) ;;
    http://localhost*|http://127.*)
      die "A VPS cannot reach your laptop. Deploy LifeOS first (see docs/13-DEPLOY.md)." ;;
    *) die "LIFEOS_URL must be https:// in production." ;;
  esac

  case "$LIFEOS_AGENT_TOKEN" in
    lifeos_agent_*) ;;
    *) die "That doesn't look like an agent token (they start with 'lifeos_agent_'). Mint one in LifeOS → Agent." ;;
  esac

  # Echo a masked summary so a mistyped or swallowed value is obvious *now*
  # rather than as a silent "I can't think yet" reply hours later.
  mask() { [ ${#1} -le 8 ] && printf '%s' "$1" || printf '%s…%s' "${1:0:6}" "${1: -4}"; }
  echo
  say "Confirm:"
  printf '     LifeOS URL : %s\n'  "${LIFEOS_URL%/}"
  printf '     Token      : %s\n'  "$(mask "$LIFEOS_AGENT_TOKEN")"
  printf '     Model key  : %s\n'  "$(mask "$MODEL_API_KEY")"
  printf '     Model      : %s @ %s\n' "$MODEL" "$MODEL_BASE_URL"
  read -r -p "  Correct? [Y/n] " __ok </dev/tty || true
  case "${__ok:-y}" in [nN]*) die "Aborted — re-run to try again." ;; esac

  umask 077
  cat > .env <<EOF
LIFEOS_URL=${LIFEOS_URL%/}
LIFEOS_AGENT_TOKEN=$LIFEOS_AGENT_TOKEN
MODEL_API_KEY=$MODEL_API_KEY
MODEL_BASE_URL=${MODEL_BASE_URL:-https://api.groq.com/openai/v1}
MODEL=${MODEL:-qwen/qwen3.8-27b}
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
