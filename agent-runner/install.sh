#!/usr/bin/env bash
# LifeOS agent — installs, checks and looks after the agent on your server.
#
#   curl -fsSL https://<your LifeOS>/api/agent/runner/install.sh | sudo bash
#
# Run on a fresh Debian or Ubuntu server, never on your own computer. It
# checks everything before changing anything: this server, that LifeOS
# answers, that your token and your model key work. Then it installs Docker
# if needed, starts the agent as a hardened container that survives reboots,
# and waits until LifeOS has heard from it.
#
# Afterwards, on the server:
#   lifeos-agent status      is it running, and does LifeOS hear it?
#   lifeos-agent logs        what it is doing, live
#   lifeos-agent update      the latest agent from your LifeOS
#   lifeos-agent token       a new token (after "Generate token" in LifeOS)
#   lifeos-agent config      another model or model key
#   lifeos-agent doctor      every check, changing nothing
#   lifeos-agent restart | stop | start | uninstall
#
# Without a terminal (cloud-init, automation), pass the answers instead:
#   LIFEOS_AGENT_TOKEN=… MODEL_API_KEY=… [MODEL_BASE_URL=… MODEL=…] bash install.sh install --yes
#
# The agent holds two secrets, both typed here and kept in an owner-only
# file on this server: a LifeOS token (scoped, revocable) and a model key.
# No database, Notion or payment credential ever comes here.
set -euo pipefail
umask 077

SCRIPT_VERSION="2"
# Written in by the LifeOS that served this script (the placeholders stay when
# it is run from a copy of the repository).
BAKED_URL="__LIFEOS_URL__"
BAKED_LANG="__LIFEOS_LANG__"
case "$BAKED_URL" in __LIFEOS*) BAKED_URL="" ;; esac
case "$BAKED_LANG" in en | fr) ;; *) BAKED_LANG="" ;; esac

APP_DIR="${APP_DIR:-/opt/lifeos-agent}"
ENV_FILE="$APP_DIR/.env"
BIN="${LIFEOS_AGENT_BIN:-/usr/local/bin/lifeos-agent}"
SELF_COPY="$APP_DIR/lifeos-agent.sh"
# Everything the image needs. Keep in step with the Dockerfile's COPY and
# lib/agent/runner-files.ts — a missing file fails the build, or worse,
# starts a container that crashes on an unresolved import.
RUNNER_FILES="index.mjs retry.mjs Dockerfile docker-compose.yml"
DEFAULT_GROQ_MODEL="qwen/qwen3.8-27b"
DEFAULT_MISTRAL_MODEL="mistral-small-latest"

# ── Language and output ──────────────────────────────────────────────
UI_LANG="${LIFEOS_LANG:-$BAKED_LANG}"
if [ -z "$UI_LANG" ]; then
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in fr*) UI_LANG=fr ;; *) UI_LANG=en ;; esac
fi
L() { if [ "$UI_LANG" = fr ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; CYAN=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi
step() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }
say() { printf '  %s\n' "$*"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
bad() { printf '  %s✗%s %s\n' "$RED" "$RESET" "$*" >&2; }
hint() { printf '    %s%s%s\n' "$DIM" "$*" "$RESET"; }
die() {
  bad "$1"
  shift
  for h in "$@"; do hint "$h"; done
  exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── Arguments ────────────────────────────────────────────────────────
COMMAND="install"
YES=0
for arg in "$@"; do
  case "$arg" in
    -y | --yes) YES=1 ;;
    -h | --help | help) COMMAND="help" ;;
    install | status | logs | update | token | config | doctor | restart | stop | start | uninstall) COMMAND="$arg" ;;
    *) die "$(L "Unknown argument: $arg" "Argument inconnu : $arg")" "$(L "lifeos-agent help lists the commands." "lifeos-agent help liste les commandes.")" ;;
  esac
done

# What was passed in as variables, before any saved setting is read over it.
GIVEN_TOKEN="${LIFEOS_AGENT_TOKEN:-}"
GIVEN_KEY="${MODEL_API_KEY:-}"
GIVEN_BASE="${MODEL_BASE_URL:-}"
GIVEN_MODEL="${MODEL:-}"

# ── Asking ───────────────────────────────────────────────────────────
# Read from the terminal, not stdin: piped from curl, stdin is this script.
has_tty() { (exec </dev/tty) 2>/dev/null; }
clean() { printf '%s' "$1" | tr -d '\r\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }

ask() { # ask VAR "prompt" [default]
  local __var=$1 __prompt=$2 __default=${3:-} __val=""
  has_tty || die "$(L "No terminal to ask on." "Pas de terminal pour poser la question.")" "$(L "Pass the answers as variables (see the top of this script)." "Passez les réponses en variables (voir le début de ce script).")"
  if [ -n "$__default" ]; then
    read -r -p "  $__prompt [$__default] " __val </dev/tty || true
    __val=$(clean "$__val")
    [ -n "$__val" ] || __val=$__default
  else
    while [ -z "$__val" ]; do
      read -r -p "  $__prompt " __val </dev/tty || true
      __val=$(clean "$__val")
    done
  fi
  printf -v "$__var" '%s' "$__val"
}

ask_secret() { # ask_secret VAR "prompt" — what is typed or pasted is not shown
  local __var=$1 __prompt=$2 __val=""
  has_tty || die "$(L "No terminal to ask on." "Pas de terminal pour poser la question.")" "$(L "Pass the answers as variables (see the top of this script)." "Passez les réponses en variables (voir le début de ce script).")"
  while [ -z "$__val" ]; do
    read -r -s -p "  $__prompt " __val </dev/tty || true
    printf '\n'
    __val=$(clean "$__val")
  done
  printf -v "$__var" '%s' "$__val"
}

confirm() { # confirm "question" — yes by default; --yes answers yes
  [ "$YES" = 1 ] && return 0
  has_tty || return 0
  local a=""
  read -r -p "  $1 [$(L "Y/n" "O/n")] " a </dev/tty || true
  case "$a" in [nN]*) return 1 ;; *) return 0 ;; esac
}

mask() { local s=$1; if [ ${#s} -le 12 ]; then printf '%s' "${s:0:2}…"; else printf '%s…%s' "${s:0:8}" "${s: -4}"; fi; }

# ── The .env file ────────────────────────────────────────────────────
get_env() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 || true; }
set_env() { # set_env KEY VALUE — replaces the key's line or adds it; values never pass through a regex
  mkdir -p "$APP_DIR"
  touch "$ENV_FILE"
  KEY="$1" VAL="$2" awk 'BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VAL"]; done = 0 }
    index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" >"$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

# ── Talking to LifeOS and to the model ───────────────────────────────
# Secrets go to curl on its standard input (-K -), never on its command line:
# a command line is visible to every user of the machine while it runs.
HTTP_CODE=""
HTTP_BODY=""
http() { # http METHOD URL [bearer] [json body]
  local method=$1 url=$2 bearer=${3:-} body=${4:-} cfg="$TMP/curl.cfg"
  # The bearer goes in a config file only root can read; the body (no secret
  # in it) on curl's standard input.
  : >"$cfg"
  if [ -n "$bearer" ]; then printf 'header = "Authorization: Bearer %s"\n' "$bearer" >>"$cfg"; fi
  if [ -n "$body" ]; then
    HTTP_CODE=$(printf '%s' "$body" | curl -sS -m 30 -X "$method" -K "$cfg" -H "Content-Type: application/json" --data-binary @- \
      -o "$TMP/response" -w '%{http_code}' -A "lifeos-agent-installer/$SCRIPT_VERSION" "$url" 2>"$TMP/curl.err") || HTTP_CODE="000"
  else
    HTTP_CODE=$(curl -sS -m 30 -X "$method" -K "$cfg" -o "$TMP/response" -w '%{http_code}' -A "lifeos-agent-installer/$SCRIPT_VERSION" "$url" 2>"$TMP/curl.err") || HTTP_CODE="000"
  fi
  HTTP_BODY=$(head -c 4000 "$TMP/response" 2>/dev/null || true)
  rm -f "$cfg"
}
json_field() { printf '%s' "$HTTP_BODY" | sed -n "s/.*\"$1\":\(\"[^\"]*\"\|[^,}]*\).*/\1/p" | head -n 1 | tr -d '"'; }

check_url() { # check_url URL — LifeOS answers there, with the agent API
  local url=$1
  http GET "$url/api/agent/v1/ping"
  case "$HTTP_CODE" in
    000) die "$(L "This server cannot reach $url" "Ce serveur ne joint pas $url")" "$(tr -d '\n' <"$TMP/curl.err" | head -c 200)" "$(L "Check the address, and that this server has internet access (curl -I $url)." "Vérifiez l'adresse, et que ce serveur a accès à internet (curl -I $url).")" ;;
  esac
  if ! printf '%s' "$HTTP_BODY" | grep -q '"service":"lifeos-agent"'; then
    die "$(L "$url answers, but it is not a LifeOS with the agent (HTTP $HTTP_CODE)." "$url répond, mais ce n'est pas un LifeOS avec l'agent (HTTP $HTTP_CODE).")" "$(L "Use the address you open LifeOS at — the command on LifeOS → Agent has it." "Utilisez l'adresse où vous ouvrez LifeOS — la commande de LifeOS → Agent la contient.")"
  fi
  if [ "$HTTP_CODE" = 503 ]; then
    die "$(L "LifeOS answers, but has no database configured: the agent cannot work with it yet." "LifeOS répond, mais n'a pas de base de données configurée : l'agent ne peut pas encore travailler avec.")" "$(L "Configure Supabase on your LifeOS (docs/13-DEPLOY.md), then run this again." "Configurez Supabase sur votre LifeOS (docs/13-DEPLOY.md), puis relancez.")"
  fi
  ok "$(L "LifeOS answers at $url" "LifeOS répond à $url")"
}

check_token() { # check_token URL TOKEN — 0 accepted, 1 refused (another token is needed); dies on anything else
  case "$2" in
    lifeos_agent_*) ;;
    *)
      bad "$(L "That is not an agent token: they start with lifeos_agent_" "Ce n'est pas un jeton d'agent : ils commencent par lifeos_agent_")"
      return 1
      ;;
  esac
  http GET "$1/api/agent/v1/ping" "$2"
  case "$HTTP_CODE" in
    200)
      ok "$(L "Token accepted" "Jeton accepté")"
      if [ "$(json_field killSwitch)" = "true" ]; then
        warn "$(L "The kill switch is on in LifeOS: the agent will wait until you turn it off." "L'arrêt d'urgence est activé dans LifeOS : l'agent attendra que vous le désactiviez.")"
      fi
      return 0
      ;;
    401)
      bad "$(L "LifeOS refuses this token: revoked, replaced by a newer one, or mistyped." "LifeOS refuse ce jeton : révoqué, remplacé par un plus récent, ou mal copié.")"
      return 1
      ;;
    *) die "$(L "LifeOS could not check the token (HTTP $HTTP_CODE)." "LifeOS n'a pas pu vérifier le jeton (HTTP $HTTP_CODE).")" "$(printf '%s' "$HTTP_BODY" | head -c 200)" ;;
  esac
}

token_step() { # a token LifeOS accepts: the one given or saved, else asked for (three tries)
  local tries=0
  LIFEOS_AGENT_TOKEN="${LIFEOS_AGENT_TOKEN:-}"
  while :; do
    ask_token
    check_token "$LIFEOS_URL" "$LIFEOS_AGENT_TOKEN" && return 0
    tries=$((tries + 1))
    if [ "$tries" -ge 3 ] || ! has_tty || [ "$YES" = 1 ]; then
      die "$(L "No accepted token: nothing was changed." "Aucun jeton accepté : rien n'a été modifié.")" "$(L "In LifeOS → Agent → Install on a server, Generate token, then run this again." "Dans LifeOS → Agent → Installer sur un serveur, Générer un jeton, puis relancez.")"
    fi
    hint "$(L "In LifeOS → Agent → Install on a server: Generate token, and paste the new one." "Dans LifeOS → Agent → Installer sur un serveur : Générer un jeton, et collez le nouveau.")"
    LIFEOS_AGENT_TOKEN=""
  done
}

check_model() { # check_model BASE KEY MODEL — the call the agent makes, in miniature
  local base=${1%/} key=$2 model=$3 msg
  local body
  # JSON mode, as the agent asks for it; "/no_think" keeps a Qwen 3 from reasoning aloud first (the agent does the same).
  body=$(printf '{"model":"%s","max_tokens":300,"temperature":0,"response_format":{"type":"json_object"},"messages":[{"role":"system","content":"Reply only with the JSON object {\\"ok\\": true}."},{"role":"user","content":"ping /no_think"}]}' "$model")
  http POST "$base/chat/completions" "$key" "$body"
  msg=$(printf '%s' "$HTTP_BODY" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | head -n 1 | head -c 220)
  case "$HTTP_CODE" in
    200) ok "$(L "The model answers: $model" "Le modèle répond : $model")"; return 0 ;;
    429) warn "$(L "Key accepted; the provider is rate-limiting it right now. The agent waits and retries on its own." "Clé acceptée ; le fournisseur la limite en ce moment. L'agent attend et réessaie seul.")"; return 0 ;;
    401 | 403) bad "$(L "The provider refused this key (HTTP $HTTP_CODE)." "Le fournisseur refuse cette clé (HTTP $HTTP_CODE).")"; [ -n "$msg" ] && hint "$msg"; return 1 ;;
    402) bad "$(L "The provider asks for payment on this account (HTTP 402)." "Le fournisseur demande un paiement sur ce compte (HTTP 402).")"; [ -n "$msg" ] && hint "$msg"; return 1 ;;
    404) bad "$(L "The provider does not serve the model $model (HTTP 404)." "Le fournisseur ne sert pas le modèle $model (HTTP 404).")"; [ -n "$msg" ] && hint "$msg"; return 1 ;;
    400)
      bad "$(L "The provider refused the request (HTTP 400)." "Le fournisseur a refusé la requête (HTTP 400).")"
      [ -n "$msg" ] && hint "$msg"
      hint "$(L "The agent needs a model that answers in JSON mode (response_format). Pick another model." "L'agent a besoin d'un modèle qui répond en mode JSON (response_format). Choisissez-en un autre.")"
      return 1
      ;;
    000) warn "$(L "Could not reach $base: $(tr -d '\n' <"$TMP/curl.err" | head -c 160)" "Impossible de joindre $base : $(tr -d '\n' <"$TMP/curl.err" | head -c 160)")"; return 2 ;;
    *) warn "$(L "The provider answered HTTP $HTTP_CODE." "Le fournisseur a répondu HTTP $HTTP_CODE.")"; [ -n "$msg" ] && hint "$msg"; return 2 ;;
  esac
}

# ── This server ──────────────────────────────────────────────────────
need_root() { [ "$(id -u)" -eq 0 ] || die "$(L "Run as root: put sudo before bash." "Lancez en root : ajoutez sudo devant bash.")"; }

check_system() {
  local id="" pretty arch mem_mb disk_mb
  pretty="$(uname -s 2>/dev/null || echo "?")"
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    id=${ID:-}
    pretty=${PRETTY_NAME:-${id:-$pretty}}
  fi
  case "$id" in
    debian | ubuntu) ok "$pretty" ;;
    *) warn "$(L "$pretty: not tested (Debian and Ubuntu are). Docker's installer supports most systems." "$pretty : pas testé (Debian et Ubuntu le sont). L'installateur de Docker gère la plupart des systèmes.")" ;;
  esac
  arch=$(uname -m)
  case "$arch" in
    x86_64 | aarch64 | arm64) ok "$(L "Processor: $arch" "Processeur : $arch")" ;;
    *) warn "$(L "Processor $arch: the Node image may not exist for it." "Processeur $arch : l'image Node n'existe peut-être pas pour lui.")" ;;
  esac
  mem_mb=$(awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || echo 0)
  if [ "${mem_mb:-0}" -ge 900 ]; then ok "$(L "Memory: $mem_mb MB" "Mémoire : $mem_mb Mo")"
  elif [ "${mem_mb:-0}" -ge 450 ]; then warn "$(L "Memory: $mem_mb MB — enough for the agent (it is capped at 256 MB), tight for building its image." "Mémoire : $mem_mb Mo — assez pour l'agent (plafonné à 256 Mo), juste pour construire son image.")"
  else warn "$(L "Memory: $mem_mb MB — below what Docker needs to build comfortably (1 GB recommended)." "Mémoire : $mem_mb Mo — en dessous de ce qu'il faut à Docker pour construire (1 Go conseillé).")"; fi
  disk_mb=$({ df -Pm /var/lib 2>/dev/null || df -Pm / 2>/dev/null; } | awk 'NR == 2 { print $4 }' || echo 0)
  if [ "${disk_mb:-0}" -ge 1500 ]; then ok "$(L "Free disk: $disk_mb MB" "Disque libre : $disk_mb Mo")"
  else warn "$(L "Free disk: $disk_mb MB — Docker and the image need about 1.5 GB." "Disque libre : $disk_mb Mo — Docker et l'image demandent environ 1,5 Go.")"; fi
  command -v curl >/dev/null 2>&1 || die "$(L "curl is missing: apt-get install -y curl" "curl manque : apt-get install -y curl")"
}

# ── Choosing the address, the token, the model ───────────────────────
resolve_url() {
  LIFEOS_URL="${LIFEOS_URL:-$(get_env LIFEOS_URL)}"
  LIFEOS_URL="${LIFEOS_URL:-$BAKED_URL}"
  [ -n "$LIFEOS_URL" ] || ask LIFEOS_URL "$(L "Address of your LifeOS (https://…):" "Adresse de votre LifeOS (https://…) :")"
  LIFEOS_URL=${LIFEOS_URL%/}
  case "$LIFEOS_URL" in
    https://*) ;;
    http://*)
      if [ "${LIFEOS_AGENT_DEV:-}" = 1 ]; then warn "$(L "Plain http allowed (LIFEOS_AGENT_DEV=1): for testing only." "http simple autorisé (LIFEOS_AGENT_DEV=1) : pour les tests seulement.")"
      else die "$(L "The address must start with https://" "L'adresse doit commencer par https://")" "$(L "A server cannot reach a LifeOS running on your computer: deploy it first (docs/13-DEPLOY.md)." "Un serveur ne peut pas joindre un LifeOS qui tourne sur votre ordinateur : déployez-le d'abord (docs/13-DEPLOY.md).")"; fi
      ;;
    *) die "$(L "Not a web address: $LIFEOS_URL" "Ce n'est pas une adresse web : $LIFEOS_URL")" ;;
  esac
}

ask_token() {
  if [ -z "${LIFEOS_AGENT_TOKEN:-}" ]; then
    say "$(L "Paste the token from LifeOS → Agent → Install on a server (it will not show as you paste):" "Collez le jeton de LifeOS → Agent → Installer sur un serveur (il ne s'affiche pas quand vous le collez) :")"
    ask_secret LIFEOS_AGENT_TOKEN "$(L "Token:" "Jeton :")"
    ok "$(L "Received" "Reçu") $(mask "$LIFEOS_AGENT_TOKEN")"
  fi
  LIFEOS_AGENT_TOKEN=$(clean "$LIFEOS_AGENT_TOKEN")
}

choose_model() {
  local choice=""
  if [ -n "${MODEL_API_KEY:-}" ]; then
    MODEL_BASE_URL="${MODEL_BASE_URL:-https://api.groq.com/openai/v1}"
    MODEL="${MODEL:-$DEFAULT_GROQ_MODEL}"
    MODEL_API_KEY=$(clean "$MODEL_API_KEY")
    return 0
  fi
  say "$(L "Which model provider? The agent thinks with it; the key stays on this server." "Quel fournisseur de modèle ? L'agent pense avec lui ; la clé reste sur ce serveur.")"
  say "  1) Groq — $(L "free tier, no card (recommended)" "offre gratuite, sans carte (conseillé)")   https://console.groq.com/keys"
  say "  2) Mistral — $(L "Paris, hosted in the EU" "Paris, hébergé dans l'UE")              https://console.mistral.ai/api-keys"
  say "  3) OpenRouter — $(L "many models" "de nombreux modèles")                     https://openrouter.ai/settings/keys"
  say "  4) $(L "Another OpenAI-compatible endpoint" "Un autre service compatible OpenAI")"
  ask choice "$(L "Choice:" "Choix :")" 1
  case "$choice" in
    2) MODEL_BASE_URL="https://api.mistral.ai/v1"; ask MODEL "$(L "Model:" "Modèle :")" "$DEFAULT_MISTRAL_MODEL" ;;
    3) MODEL_BASE_URL="https://openrouter.ai/api/v1"; ask MODEL "$(L "Model id (see https://openrouter.ai/models):" "Identifiant du modèle (voir https://openrouter.ai/models) :")" ;;
    4) ask MODEL_BASE_URL "$(L "Base URL (ending in /v1):" "URL de base (finissant par /v1) :")"; ask MODEL "$(L "Model id:" "Identifiant du modèle :")" ;;
    *) MODEL_BASE_URL="https://api.groq.com/openai/v1"; ask MODEL "$(L "Model:" "Modèle :")" "$DEFAULT_GROQ_MODEL" ;;
  esac
  ask_secret MODEL_API_KEY "$(L "API key (it will not show as you paste):" "Clé d'API (elle ne s'affiche pas quand vous la collez) :")"
  ok "$(L "Received" "Reçue") $(mask "$MODEL_API_KEY")"
}

model_step() { # asks (unless given), checks, and asks again on a refusal
  local tries=0 rc=0
  while :; do
    choose_model
    rc=0
    check_model "$MODEL_BASE_URL" "$MODEL_API_KEY" "$MODEL" || rc=$?
    [ "$rc" = 0 ] && return 0
    if [ "$rc" = 2 ]; then
      confirm "$(L "The provider could not be checked right now. Continue anyway?" "Le fournisseur n'a pas pu être vérifié pour l'instant. Continuer quand même ?")" && return 0
    fi
    tries=$((tries + 1))
    if [ "$tries" -ge 3 ] || ! has_tty || [ "$YES" = 1 ]; then die "$(L "No working model: nothing was changed." "Aucun modèle qui fonctionne : rien n'a été modifié.")"; fi
    say "$(L "Let's try again." "Recommençons.")"
    MODEL_API_KEY=""
    MODEL=""
    MODEL_BASE_URL=""
  done
}

# ── Docker ───────────────────────────────────────────────────────────
dc() { docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" "$@"; }

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    say "$(L "Installing Docker (its official script, get.docker.com)…" "Installation de Docker (son script officiel, get.docker.com)…")"
    curl -fsSL https://get.docker.com | sh >"$TMP/docker-install.log" 2>&1 || {
      tail -n 15 "$TMP/docker-install.log" >&2
      die "$(L "Docker did not install." "Docker ne s'est pas installé.")"
    }
    ok "$(L "Docker installed" "Docker installé")"
  else
    ok "Docker $(docker --version 2>/dev/null | sed -n 's/^Docker version \([^,]*\).*/\1/p')"
  fi
  if command -v systemctl >/dev/null 2>&1; then systemctl enable --now docker >/dev/null 2>&1 || true; fi
  if ! docker compose version >/dev/null 2>&1; then
    say "$(L "Adding Docker Compose…" "Ajout de Docker Compose…")"
    (apt-get update -qq && apt-get install -y -qq docker-compose-plugin) >/dev/null 2>&1 || true
    docker compose version >/dev/null 2>&1 || die "$(L "Docker Compose v2 is missing." "Docker Compose v2 manque.")" "$(L "Install the docker-compose-plugin package, or Docker from get.docker.com." "Installez le paquet docker-compose-plugin, ou Docker depuis get.docker.com.")"
  fi
  docker info >/dev/null 2>&1 || die "$(L "Docker is installed but not running." "Docker est installé mais ne tourne pas.")" "systemctl status docker"
}

# ── The agent's files ────────────────────────────────────────────────
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"

fetch_files() { # from the folder this script was run from, or from LifeOS
  mkdir -p "$APP_DIR"
  local f expected actual host_net=0
  # Hermes on this server (docs/15-HERMES.md) needs the host's network: a
  # setting made by hand in the compose file, kept across updates.
  if [ -f "$APP_DIR/docker-compose.yml" ] && grep -qE '^[[:space:]]+network_mode:[[:space:]]*host' "$APP_DIR/docker-compose.yml"; then host_net=1; fi
  if [ "${1:-}" != "remote" ] && [ -n "$SRC_DIR" ] && [ "$SRC_DIR" != "$APP_DIR" ] && [ -f "$SRC_DIR/index.mjs" ]; then
    for f in $RUNNER_FILES; do
      [ -f "$SRC_DIR/$f" ] || die "$(L "Missing $f next to this script." "$f manque à côté de ce script.")"
      tr -d '\r' <"$SRC_DIR/$f" >"$APP_DIR/$f"
      chmod 644 "$APP_DIR/$f"
    done
    keep_host_net "$host_net"
    ok "$(L "Agent files copied from $SRC_DIR" "Fichiers de l'agent copiés depuis $SRC_DIR")"
    return 0
  fi
  http GET "$LIFEOS_URL/api/agent/runner/manifest.json"
  [ "$HTTP_CODE" = 200 ] || die "$(L "LifeOS did not give the list of the agent's files (HTTP $HTTP_CODE)." "LifeOS n'a pas donné la liste des fichiers de l'agent (HTTP $HTTP_CODE).")"
  cp "$TMP/response" "$TMP/manifest.json"
  for f in $RUNNER_FILES; do
    curl -fsS -m 60 -A "lifeos-agent-installer/$SCRIPT_VERSION" -o "$TMP/$f" "$LIFEOS_URL/api/agent/runner/$f" ||
      die "$(L "Could not download $f from LifeOS." "Impossible de télécharger $f depuis LifeOS.")"
    expected=$(sed -n "s/.*\"$f\":\"\([0-9a-f]\{64\}\)\".*/\1/p" "$TMP/manifest.json")
    actual=$(sha256sum "$TMP/$f" | cut -d ' ' -f 1)
    [ -n "$expected" ] && [ "$expected" = "$actual" ] || die "$(L "$f did not arrive intact (its checksum differs). Run the command again." "$f n'est pas arrivé intact (somme de contrôle différente). Relancez la commande.")"
  done
  for f in $RUNNER_FILES; do mv "$TMP/$f" "$APP_DIR/$f"; done
  chmod 644 "$APP_DIR"/*.mjs "$APP_DIR/Dockerfile" "$APP_DIR/docker-compose.yml"
  keep_host_net "$host_net"
  ok "$(L "Agent files downloaded and checked" "Fichiers de l'agent téléchargés et vérifiés")"
}

keep_host_net() { # keep_host_net 0|1 — puts network_mode: host back if it was set
  [ "$1" = 1 ] || return 0
  sed -i 's/^\([[:space:]]*\)# network_mode: host/\1network_mode: host/' "$APP_DIR/docker-compose.yml"
  ok "$(L "Kept network_mode: host (Hermes)" "network_mode: host conservé (Hermes)")"
}

install_self() { # this script becomes the lifeos-agent command (atomic: a running script is never rewritten in place)
  local src="${BASH_SOURCE[0]:-}"
  if [ -n "$src" ] && [ -f "$src" ] && [ "$src" != "$SELF_COPY" ]; then
    tr -d '\r' <"$src" >"$SELF_COPY.tmp"
  else
    curl -fsS -m 60 -o "$SELF_COPY.tmp" "$LIFEOS_URL/api/agent/runner/install.sh?lang=$UI_LANG" || { rm -f "$SELF_COPY.tmp"; return 0; }
  fi
  chmod 755 "$SELF_COPY.tmp"
  mv "$SELF_COPY.tmp" "$SELF_COPY"
  ln -sf "$SELF_COPY" "$BIN"
}

write_env() {
  set_env LIFEOS_URL "$LIFEOS_URL"
  set_env LIFEOS_AGENT_TOKEN "$LIFEOS_AGENT_TOKEN"
  set_env MODEL_API_KEY "$MODEL_API_KEY"
  set_env MODEL_BASE_URL "$MODEL_BASE_URL"
  set_env MODEL "$MODEL"
  # Tuning: written once, a deliberate change is left alone.
  if [ -z "$(get_env POLL_MS)" ]; then set_env POLL_MS 10000; fi
  if [ -z "$(get_env HOT_POLL_MS)" ]; then set_env HOT_POLL_MS 1500; fi
  if [ -z "$(get_env AUTONOMOUS_MS)" ]; then set_env AUTONOMOUS_MS 900000; fi
  # Our own old defaults, which made the agent feel broken: a 30 s idle poll,
  # and a model Groq has since retired (every answer an HTTP 404).
  if [ "$(get_env POLL_MS)" = 30000 ]; then set_env POLL_MS 10000; fi
  if [ "$(get_env MODEL)" = "llama-3.3-70b-versatile" ]; then set_env MODEL "$DEFAULT_GROQ_MODEL"; fi
  ok "$(L "Settings written to $ENV_FILE (readable by root only)" "Réglages écrits dans $ENV_FILE (lisible par root seulement)")"
}

load_env() {
  [ -f "$ENV_FILE" ] || die "$(L "The agent is not installed here ($ENV_FILE is missing)." "L'agent n'est pas installé ici ($ENV_FILE manque).")" "curl -fsSL https://<LifeOS>/api/agent/runner/install.sh | sudo bash"
  LIFEOS_URL=$(get_env LIFEOS_URL)
  LIFEOS_AGENT_TOKEN=$(get_env LIFEOS_AGENT_TOKEN)
  MODEL_API_KEY=$(get_env MODEL_API_KEY)
  MODEL_BASE_URL=$(get_env MODEL_BASE_URL)
  MODEL=$(get_env MODEL)
}

# ── Starting, and waiting until LifeOS hears the agent ───────────────
start_and_wait() { # start_and_wait [--build]
  say "$(L "Starting the agent…" "Démarrage de l'agent…")"
  dc up -d --remove-orphans "$@" >"$TMP/compose.log" 2>&1 || {
    tail -n 25 "$TMP/compose.log" >&2
    die "$(L "The container did not start." "Le conteneur n'a pas démarré.")"
  }
  local started now seen i
  started=$(date +%s)
  for i in $(seq 1 30); do
    sleep 2
    if [ -z "$(dc ps --status running -q 2>/dev/null)" ]; then
      bad "$(L "The agent stopped right after starting. Its last words:" "L'agent s'est arrêté juste après son démarrage. Ses derniers mots :")"
      dc logs --tail 20 >&2 || true
      exit 1
    fi
    http GET "$LIFEOS_URL/api/agent/v1/ping" "$LIFEOS_AGENT_TOKEN"
    if [ "$HTTP_CODE" = 401 ]; then
      die "$(L "LifeOS refuses this agent's token (revoked, or a newer one was generated)." "LifeOS refuse le jeton de cet agent (révoqué, ou un plus récent a été généré).")" "lifeos-agent token"
    fi
    seen=$(json_field seenSecondsAgo)
    now=$(date +%s)
    if [ "$HTTP_CODE" = 200 ] && [ -n "$seen" ] && [ "$seen" != null ] && [ "$seen" -le $((now - started + 2)) ]; then
      ok "$(L "LifeOS hears your agent." "LifeOS entend votre agent.")"
      return 0
    fi
  done
  warn "$(L "The container runs, but LifeOS has not heard from it within a minute. Its last lines:" "Le conteneur tourne, mais LifeOS ne l'a pas entendu en une minute. Ses dernières lignes :")"
  dc logs --tail 15 || true
  hint "lifeos-agent doctor"
  exit 1
}

# ── Commands ─────────────────────────────────────────────────────────
cmd_help() {
  sed -n '2,24p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null | sed 's/^# \{0,1\}//' || true
}

cmd_install() {
  need_root
  step "$(L "LifeOS agent — installation" "Agent LifeOS — installation")"
  say "$(L "Everything is checked before anything is changed." "Tout est vérifié avant que quoi que ce soit ne change.")"

  step "1/5 · $(L "This server" "Ce serveur")"
  check_system

  step "2/5 · LifeOS"
  resolve_url
  check_url "$LIFEOS_URL"
  LIFEOS_AGENT_TOKEN="${LIFEOS_AGENT_TOKEN:-$(get_env LIFEOS_AGENT_TOKEN)}"
  token_step

  step "3/5 · $(L "The model" "Le modèle")"
  if [ -z "${MODEL_API_KEY:-}" ] && [ -n "$(get_env MODEL_API_KEY)" ]; then
    MODEL_API_KEY=$(get_env MODEL_API_KEY)
    MODEL_BASE_URL="${MODEL_BASE_URL:-$(get_env MODEL_BASE_URL)}"
    MODEL="${MODEL:-$(get_env MODEL)}"
    say "$(L "Keeping the model already set up: $MODEL ($(mask "$MODEL_API_KEY"))" "Le modèle déjà réglé est gardé : $MODEL ($(mask "$MODEL_API_KEY"))")"
    hint "$(L "To change it later: lifeos-agent config" "Pour le changer ensuite : lifeos-agent config")"
  fi
  model_step

  step "4/5 · Docker"
  ensure_docker

  step "5/5 · $(L "The agent" "L'agent")"
  fetch_files
  write_env
  install_self
  start_and_wait --build

  step "$(L "Done." "C'est fait.")"
  say "$(L "Your agent runs on this server and restarts with it." "Votre agent tourne sur ce serveur et redémarre avec lui.")"
  say "$(L "In LifeOS → Agent, write it a first message: it answers in a few seconds." "Dans LifeOS → Agent, écrivez-lui un premier message : il répond en quelques secondes.")"
  say ""
  say "lifeos-agent status · logs · update · token · config · doctor · uninstall"
  say "$(L "To stop it from anywhere: LifeOS → Agent → kill switch, or Revoke." "Pour l'arrêter de n'importe où : LifeOS → Agent → arrêt d'urgence, ou Révoquer.")"
}

cmd_status() {
  load_env
  step "$(L "LifeOS agent — status" "Agent LifeOS — état")"
  if command -v docker >/dev/null 2>&1 && [ -n "$(dc ps --status running -q 2>/dev/null)" ]; then
    local health
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$(dc ps -q | head -n 1)" 2>/dev/null || true)
    ok "$(L "Container running" "Conteneur en marche")${health:+ ($health)}"
  else
    bad "$(L "Container not running." "Conteneur à l'arrêt.")"
    hint "lifeos-agent start"
  fi
  http GET "$LIFEOS_URL/api/agent/v1/ping" "$LIFEOS_AGENT_TOKEN"
  case "$HTTP_CODE" in
    200)
      local seen
      seen=$(json_field seenSecondsAgo)
      if [ -z "$seen" ] || [ "$seen" = null ]; then warn "$(L "LifeOS has never heard from this agent." "LifeOS n'a jamais entendu cet agent.")"
      elif [ "$seen" -le 90 ]; then ok "$(L "LifeOS heard it ${seen}s ago" "LifeOS l'a entendu il y a ${seen} s")"
      else warn "$(L "LifeOS last heard it ${seen}s ago." "LifeOS l'a entendu pour la dernière fois il y a ${seen} s.")"; fi
      if [ "$(json_field killSwitch)" = "true" ]; then
        warn "$(L "Kill switch on in LifeOS: the agent waits." "Arrêt d'urgence activé dans LifeOS : l'agent attend.")"
      fi
      ;;
    401) bad "$(L "LifeOS refuses this agent's token (revoked or replaced)." "LifeOS refuse le jeton de cet agent (révoqué ou remplacé).")"; hint "lifeos-agent token" ;;
    000) bad "$(L "LifeOS unreachable from this server." "LifeOS injoignable depuis ce serveur.")" ;;
    *) warn "LifeOS: HTTP $HTTP_CODE" ;;
  esac
  say "$(L "Model:" "Modèle :") $MODEL @ $MODEL_BASE_URL"
  if command -v docker >/dev/null 2>&1; then
    say "$(L "Last lines:" "Dernières lignes :")"
    dc logs --tail 5 --no-log-prefix 2>/dev/null | sed 's/^/    /' || true
  fi
}

cmd_doctor() {
  need_root
  step "$(L "LifeOS agent — checks (nothing is changed)" "Agent LifeOS — vérifications (rien n'est modifié)")"
  step "$(L "This server" "Ce serveur")"
  check_system
  if [ -f "$ENV_FILE" ]; then load_env; else resolve_url; fi
  step "LifeOS"
  check_url "$LIFEOS_URL"
  if [ -n "${LIFEOS_AGENT_TOKEN:-}" ]; then
    check_token "$LIFEOS_URL" "$LIFEOS_AGENT_TOKEN" || hint "lifeos-agent token"
  else
    warn "$(L "No token set up yet." "Aucun jeton réglé.")"
  fi
  step "$(L "The model" "Le modèle")"
  if [ -n "${MODEL_API_KEY:-}" ]; then check_model "$MODEL_BASE_URL" "$MODEL_API_KEY" "$MODEL" || true; else warn "$(L "No model key set up yet." "Aucune clé de modèle réglée.")"; fi
  step "Docker"
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then ok "$(docker --version)"; else warn "$(L "Docker or Docker Compose missing: the installer adds them." "Docker ou Docker Compose manque : l'installateur les ajoute.")"; fi
  [ -f "$ENV_FILE" ] && cmd_status
}

cmd_token() {
  need_root
  load_env
  step "$(L "A new token for this agent" "Un nouveau jeton pour cet agent")"
  LIFEOS_AGENT_TOKEN="$GIVEN_TOKEN"
  if [ -z "$LIFEOS_AGENT_TOKEN" ]; then
    say "$(L "In LifeOS → Agent → Install on a server, Generate token, then paste it here." "Dans LifeOS → Agent → Installer sur un serveur, Générer un jeton, puis collez-le ici.")"
  fi
  token_step
  set_env LIFEOS_AGENT_TOKEN "$LIFEOS_AGENT_TOKEN"
  start_and_wait --force-recreate
}

cmd_config() {
  need_root
  load_env
  step "$(L "Another model or model key" "Un autre modèle ou une autre clé")"
  MODEL_API_KEY="$GIVEN_KEY"
  MODEL_BASE_URL="$GIVEN_BASE"
  MODEL="$GIVEN_MODEL"
  model_step
  set_env MODEL_API_KEY "$MODEL_API_KEY"
  set_env MODEL_BASE_URL "$MODEL_BASE_URL"
  set_env MODEL "$MODEL"
  start_and_wait --force-recreate
}

cmd_update() {
  need_root
  load_env
  step "$(L "Updating the agent from $LIFEOS_URL" "Mise à jour de l'agent depuis $LIFEOS_URL")"
  check_url "$LIFEOS_URL"
  check_token "$LIFEOS_URL" "$LIFEOS_AGENT_TOKEN" || die "$(L "Give the agent a token LifeOS accepts first." "Donnez d'abord à l'agent un jeton que LifeOS accepte.")" "lifeos-agent token"
  ensure_docker
  fetch_files remote
  write_env
  install_self
  start_and_wait --build
}

cmd_uninstall() {
  need_root
  step "$(L "Removing the agent from this server" "Retrait de l'agent de ce serveur")"
  if ! has_tty && [ "$YES" != 1 ]; then die "$(L "Without a terminal, uninstall needs --yes." "Sans terminal, la désinstallation demande --yes.")"; fi
  confirm "$(L "Stop the agent and delete $APP_DIR (its settings included)?" "Arrêter l'agent et supprimer $APP_DIR (réglages compris) ?")" || { say "$(L "Nothing changed." "Rien n'a changé.")"; exit 0; }
  if command -v docker >/dev/null 2>&1 && [ -f "$APP_DIR/docker-compose.yml" ]; then dc down --rmi local >/dev/null 2>&1 || true; fi
  rm -rf "$APP_DIR"
  rm -f "$BIN"
  ok "$(L "Removed. Docker stays installed." "Retiré. Docker reste installé.")"
  say "$(L "Revoke its token in LifeOS → Agent so it can never be used again." "Révoquez son jeton dans LifeOS → Agent pour qu'il ne serve plus jamais.")"
}

case "$COMMAND" in
  help) cmd_help ;;
  install) cmd_install ;;
  status) cmd_status ;;
  doctor) cmd_doctor ;;
  token) cmd_token ;;
  config) cmd_config ;;
  update) cmd_update ;;
  uninstall) cmd_uninstall ;;
  logs) load_env; dc logs -f --tail 100 ;;
  restart) need_root; load_env; dc restart && ok "$(L "Restarted" "Redémarré")" ;;
  stop) need_root; load_env; dc stop && ok "$(L "Stopped. lifeos-agent start to start it again." "Arrêté. lifeos-agent start pour le relancer.")" ;;
  start) need_root; load_env; start_and_wait ;;
esac
