#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# --- Dependency check ---
if ! command -v gum &>/dev/null; then
  echo "This script requires 'gum' for interactive menus."
  echo "Install: brew install gum"
  exit 1
fi

# --- Buildable services (have a build: key) ---
BUILDABLE_SERVICES=(api scraper web batch-clusterer migrate recluster reembed resummarize diagnostics)
STARTABLE_SERVICES=(postgres redis batch-clusterer api scraper web)

# --- Helpers ---
header() {
  echo ""
  gum style --border normal --padding "0 1" --border-foreground 212 "$1"
}

run_cmd() {
  echo ""
  gum style --foreground 212 "$ $*"
  "$@"
}

wait_postgres() {
  echo "  Waiting for postgres..."
  docker compose exec postgres sh -c 'until pg_isready -U korkep; do sleep 1; done' >/dev/null 2>&1
}

wait_api() {
  echo "  Waiting for API health..."
  docker compose exec api sh -c \
    'for i in $(seq 1 30); do node -e "fetch(\"http://localhost:3001/health\").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" 2>/dev/null && exit 0; sleep 2; done; exit 1'
}

# --- Actions ---
action_build() {
  header "Build Containers"
  local selected
  selected=$(gum choose --no-limit --header "Select services to build (space to select, enter to confirm)" "${BUILDABLE_SERVICES[@]}" "ALL")

  if [[ -z "$selected" ]]; then
    echo "  Nothing selected."
    return
  fi

  local no_cache=""
  if gum confirm "Build with --no-cache?" --default=No; then
    no_cache="--no-cache"
  fi

  if echo "$selected" | grep -q "ALL"; then
    run_cmd docker compose build ${no_cache}
  else
    local services=()
    while IFS= read -r svc; do
      services+=("$svc")
    done <<< "$selected"
    run_cmd docker compose build ${no_cache} "${services[@]}"
  fi
}

action_start() {
  header "Start Services"
  local selected
  selected=$(gum choose --no-limit --header "Select services to start (space to select, enter to confirm)" "${STARTABLE_SERVICES[@]}" "ALL")

  if [[ -z "$selected" ]]; then
    echo "  Nothing selected."
    return
  fi

  if echo "$selected" | grep -q "ALL"; then
    run_cmd docker compose up -d
  else
    local services=()
    while IFS= read -r svc; do
      services+=("$svc")
    done <<< "$selected"
    run_cmd docker compose up -d "${services[@]}"
  fi
}

action_stop() {
  header "Stop Services"
  local running
  running=$(docker compose ps --format '{{.Name}}' 2>/dev/null | sed 's/^groundnews-//' | sed 's/-1$//' || true)
  if [[ -z "$running" ]]; then
    echo "  No services running."
    return
  fi

  local selected
  selected=$(printf '%s\n' $running "ALL" | gum choose --no-limit --header "Select services to stop (space to select, enter to confirm)")

  if [[ -z "$selected" ]]; then
    echo "  Nothing selected."
    return
  fi

  if echo "$selected" | grep -q "ALL"; then
    run_cmd docker compose down
  else
    local services=()
    while IFS= read -r svc; do
      services+=("$svc")
    done <<< "$selected"
    run_cmd docker compose stop "${services[@]}"
  fi
}

action_migrate() {
  header "Run Migrations"
  run_cmd docker compose up -d postgres
  wait_postgres
  run_cmd docker compose --profile setup run --rm migrate
}

action_recluster() {
  header "Recluster"
  local env_args=()

  if gum confirm "Override clustering model?" --default=No; then
    local model
    model=$(gum input --placeholder "e.g. openai/gpt-4o-mini")
    env_args+=(-e "STORY_MODEL_OVERRIDE=${model}")
  fi

  if gum confirm "Disable cache (RECLUSTER_NO_CACHE=1)?" --default=No; then
    env_args+=(-e "RECLUSTER_NO_CACHE=1")
  fi

  run_cmd docker compose --profile recluster run --rm "${env_args[@]+"${env_args[@]}"}" recluster
}

action_reembed() {
  header "Reembed Profiles"
  run_cmd docker compose --profile reembed run --rm reembed
}

action_resummarize() {
  header "Resummarize Profiles"
  local since
  since=$(gum input --placeholder "SINCE_HOURS (default: 24)" --value "24")

  run_cmd docker compose --profile resummarize run --rm -e "SINCE_HOURS=${since}" resummarize
}

action_diagnostics() {
  header "Run Diagnostics"
  run_cmd docker compose --profile recluster run --rm diagnostics
}

action_logs() {
  header "View Logs"
  local running
  running=$(docker compose ps --services 2>/dev/null || true)
  if [[ -z "$running" ]]; then
    echo "  No services running."
    return
  fi

  local service
  service=$(printf '%s\n' $running "ALL" | gum choose --header "Which service?")

  if [[ "$service" == "ALL" ]]; then
    docker compose logs --tail 50 -f
  else
    docker compose logs --tail 50 -f "$service"
  fi
}

action_status() {
  header "Service Status"
  docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "  No services running."
}

action_full_rebuild() {
  header "Full Rebuild (build + migrate + start)"
  local no_cache=""
  if gum confirm "Build with --no-cache?" --default=No; then
    no_cache="--no-cache"
  fi

  echo "==> Building all containers..."
  run_cmd docker compose build ${no_cache}

  echo "==> Starting infrastructure..."
  run_cmd docker compose up -d postgres redis batch-clusterer

  wait_postgres

  echo "==> Running migrations..."
  run_cmd docker compose --profile setup run --rm migrate

  echo "==> Starting all services..."
  run_cmd docker compose up -d

  wait_api
  echo "  API healthy."
  action_status
}

# --- Main loop ---
ACTIONS=(
  "Build containers"
  "Start services"
  "Stop services"
  "Full rebuild (build+migrate+start)"
  "Run migrations"
  "Recluster"
  "Reembed"
  "Resummarize"
  "Diagnostics"
  "View logs"
  "Status"
  "Exit"
)

echo ""
gum style --bold --foreground 212 "groundnews interactive build"
echo ""

while true; do
  choice=$(gum choose --header "What do you want to do?" "${ACTIONS[@]}")

  case "$choice" in
    "Build containers")                 action_build ;;
    "Start services")                   action_start ;;
    "Stop services")                    action_stop ;;
    "Full rebuild (build+migrate+start)") action_full_rebuild ;;
    "Run migrations")                   action_migrate ;;
    "Recluster")                        action_recluster ;;
    "Reembed")                          action_reembed ;;
    "Resummarize")                      action_resummarize ;;
    "Diagnostics")                      action_diagnostics ;;
    "View logs")                        action_logs ;;
    "Status")                           action_status ;;
    "Exit")                             echo ""; echo "Bye."; exit 0 ;;
  esac
done
