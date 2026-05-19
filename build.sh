#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PROJECT_NAME="groundnews"

MODEL_PRESETS=(
  "gemma31b|google/gemma-4-31b-it|Best quality for recluster story titles/coherence"
  "gemma26b|google/gemma-4-26b-a4b-it|Balanced default for article analysis"
  "2.5-flash-lite|google/gemini-2.5-flash-lite|Fast/cheap Gemini fallback mode"
  "3.1-flash-lite|google/gemini-3.1-flash-lite|Newest Flash Lite option when available"
)

STARTABLE_SERVICES=(postgres redis batch-clusterer api pipeline web)

usage() {
  cat <<'EOF'
groundnews build helper

Usage:
  ./build.sh                         Open the interactive menu
  ./build.sh help                    Show this help
  ./build.sh models                  Show recommended model presets
  ./build.sh build [services...]     Build containers, or all buildable containers
  ./build.sh start [services...]     Start services, or the default app stack
  ./build.sh stop [services...]      Stop services, or docker compose down
  ./build.sh rebuild                 Build, migrate, start, and health-check
  ./build.sh migrate                 Start postgres and run migrations
  ./build.sh pipeline [options]      Run the manual pipeline job
  ./build.sh recluster [options]     Run reclustering
  ./build.sh reembed                 Run reembedding
  ./build.sh resummarize [options]   Run resummarization
  ./build.sh diagnostics             Run worker diagnostics
  ./build.sh logs [service|ALL]      Follow logs
  ./build.sh status                  Show compose status

Common options:
  --no-cache                         Build without cache, or disable recluster cache
  --mode openrouter|gemini-fallback  LLM provider mode
  --model preset-or-model-id         LLM model; presets: gemma31b, gemma26b, 2.5-flash-lite, 3.1-flash-lite
  --google-model preset-or-model-id  Google AI Studio fallback model
  --llm-concurrency n                LLM_CONCURRENCY for pipeline
  --recluster-concurrency n          RECLUSTER_LLM_CONCURRENCY
  --embedding-model model-id         EMBEDDING_MODEL for pipeline
  --embedding-concurrency n          EMBEDDING_CONCURRENCY for pipeline
  --since-hours n                    SINCE_HOURS for resummarize
  --merge-threshold value            RECLUSTER_MERGE_THRESHOLD
  --merge-max-size n                 RECLUSTER_MERGE_MAX_SIZE
  --cluster-threshold value          CLUSTER_SIMILARITY_THRESHOLD
  --cluster-window-hours n           CLUSTER_TIME_WINDOW_HOURS
  --cluster-max-size n               CLUSTER_MAX_SIZE
  --env KEY=VALUE                    Pass any extra environment variable to docker compose run

Examples:
  ./build.sh pipeline --mode openrouter --model gemma26b --llm-concurrency 7
  ./build.sh recluster --mode openrouter --model gemma31b --no-cache
  ./build.sh recluster --mode gemini-fallback --model 3.1-flash-lite --google-model 3.1-flash-lite
EOF
}

require_gum() {
  if ! command -v gum >/dev/null 2>&1; then
    echo "This script requires 'gum' for interactive menus."
    echo "Install: brew install gum"
    exit 1
  fi
}

header() {
  echo ""
  if command -v gum >/dev/null 2>&1; then
    gum style --border normal --padding "0 1" --border-foreground 212 "$1"
  else
    echo "== $1 =="
  fi
}

run_cmd() {
  echo ""
  if command -v gum >/dev/null 2>&1; then
    gum style --foreground 212 "$ $*"
  else
    printf '$'
    printf ' %q' "$@"
    echo
  fi
  "$@"
}

model_for_preset() {
  local input="${1:-}"
  local preset model description

  for entry in "${MODEL_PRESETS[@]}"; do
    IFS='|' read -r preset model description <<< "$entry"
    if [[ "$input" == "$preset" ]]; then
      echo "$model"
      return
    fi
  done

  echo "$input"
}

show_models() {
  local preset model description
  printf '\nRecommended model presets:\n'
  for entry in "${MODEL_PRESETS[@]}"; do
    IFS='|' read -r preset model description <<< "$entry"
    printf '  %-16s %-34s %s\n' "$preset" "$model" "$description"
  done
  echo ""
  echo "Use the official model id for both --model and --google-model."
}

compose_services_from_file() {
  awk '
    /^services:/ { in_services=1; next }
    in_services && /^[^[:space:]]/ { exit }
    in_services && /^  [A-Za-z0-9_-]+:/ {
      name=$1
      sub(":", "", name)
      print name
    }
  ' docker-compose.yml
}

buildable_services() {
  awk '
    /^services:/ { in_services=1; next }
    in_services && /^[^[:space:]]/ { exit }
    in_services && /^  [A-Za-z0-9_-]+:/ {
      if (service != "" && has_build) print service
      service=$1
      sub(":", "", service)
      has_build=0
      next
    }
    in_services && service != "" && /^    build:/ { has_build=1 }
    END {
      if (service != "" && has_build) print service
    }
  ' docker-compose.yml
}

build_llm_env_args() {
  local target="$1"
  shift

  local mode=""
  local model=""
  local google_model=""
  local llm_concurrency=""
  local embedding_model=""
  local embedding_concurrency=""
  local recluster_concurrency=""
  local no_cache=0
  local merge_threshold=""
  local merge_max_size=""
  local cluster_threshold=""
  local cluster_window_hours=""
  local cluster_max_size=""
  local extra_env=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mode) mode="${2:?Missing value for --mode}"; shift 2 ;;
      --model) model="$(model_for_preset "${2:?Missing value for --model}")"; shift 2 ;;
      --google-model) google_model="$(model_for_preset "${2:?Missing value for --google-model}")"; shift 2 ;;
      --llm-concurrency) llm_concurrency="${2:?Missing value for --llm-concurrency}"; shift 2 ;;
      --embedding-model) embedding_model="${2:?Missing value for --embedding-model}"; shift 2 ;;
      --embedding-concurrency) embedding_concurrency="${2:?Missing value for --embedding-concurrency}"; shift 2 ;;
      --recluster-concurrency) recluster_concurrency="${2:?Missing value for --recluster-concurrency}"; shift 2 ;;
      --no-cache) no_cache=1; shift ;;
      --merge-threshold) merge_threshold="${2:?Missing value for --merge-threshold}"; shift 2 ;;
      --merge-max-size) merge_max_size="${2:?Missing value for --merge-max-size}"; shift 2 ;;
      --cluster-threshold) cluster_threshold="${2:?Missing value for --cluster-threshold}"; shift 2 ;;
      --cluster-window-hours) cluster_window_hours="${2:?Missing value for --cluster-window-hours}"; shift 2 ;;
      --cluster-max-size) cluster_max_size="${2:?Missing value for --cluster-max-size}"; shift 2 ;;
      --env) extra_env+=("${2:?Missing value for --env}"); shift 2 ;;
      *) echo "Unknown option for $target: $1" >&2; return 2 ;;
    esac
  done

  case "$mode" in
    ""|openrouter|gemini-fallback) ;;
    *) echo "Unsupported LLM mode: $mode" >&2; return 2 ;;
  esac

  if [[ "$target" == "pipeline" ]]; then
    [[ -n "$mode" ]] && printf -- '-e LLM_PROVIDER=%s\n' "$mode"
    [[ -n "$model" ]] && printf -- '-e LLM_MODEL=%s\n' "$model"
    [[ -n "$google_model" ]] && printf -- '-e GOOGLE_AI_STUDIO_MODEL=%s\n' "$google_model"
    [[ -n "$llm_concurrency" ]] && printf -- '-e LLM_CONCURRENCY=%s\n' "$llm_concurrency"
    [[ -n "$embedding_model" ]] && printf -- '-e EMBEDDING_MODEL=%s\n' "$embedding_model"
    [[ -n "$embedding_concurrency" ]] && printf -- '-e EMBEDDING_CONCURRENCY=%s\n' "$embedding_concurrency"
  elif [[ "$target" == "recluster" ]]; then
    [[ -n "$mode" ]] && printf -- '-e RECLUSTER_LLM_PROVIDER=%s\n' "$mode"
    [[ -n "$model" ]] && printf -- '-e RECLUSTER_LLM_MODEL=%s\n' "$model"
    [[ -n "$google_model" ]] && printf -- '-e GOOGLE_AI_STUDIO_MODEL=%s\n' "$google_model"
    [[ "$no_cache" == "1" ]] && printf -- '-e RECLUSTER_NO_CACHE=1\n'
    [[ -n "$recluster_concurrency" ]] && printf -- '-e RECLUSTER_LLM_CONCURRENCY=%s\n' "$recluster_concurrency"
    [[ -n "$merge_threshold" ]] && printf -- '-e RECLUSTER_MERGE_THRESHOLD=%s\n' "$merge_threshold"
    [[ -n "$merge_max_size" ]] && printf -- '-e RECLUSTER_MERGE_MAX_SIZE=%s\n' "$merge_max_size"
  fi

  [[ -n "$cluster_threshold" ]] && printf -- '-e CLUSTER_SIMILARITY_THRESHOLD=%s\n' "$cluster_threshold"
  [[ -n "$cluster_window_hours" ]] && printf -- '-e CLUSTER_TIME_WINDOW_HOURS=%s\n' "$cluster_window_hours"
  [[ -n "$cluster_max_size" ]] && printf -- '-e CLUSTER_MAX_SIZE=%s\n' "$cluster_max_size"

  local item
  for item in "${extra_env[@]+"${extra_env[@]}"}"; do
    printf -- '-e %s\n' "$item"
  done
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

action_build() {
  header "Build Containers"
  local no_cache=()
  local services=()

  if [[ "${1:-}" == "--no-cache" ]]; then
    no_cache=(--no-cache)
    shift
  fi

  if [[ $# -gt 0 ]]; then
    services=("$@")
  else
    local svc
    while IFS= read -r svc; do
      [[ -n "$svc" ]] && services+=("$svc")
    done < <(buildable_services)
  fi

  run_cmd docker compose build ${no_cache[@]+"${no_cache[@]}"} "${services[@]}"
}

action_start() {
  header "Start Services"
  local services=("$@")
  [[ ${#services[@]} -eq 0 ]] && services=("${STARTABLE_SERVICES[@]}")
  run_cmd docker compose up -d "${services[@]}"
}

action_stop() {
  header "Stop Services"
  if [[ $# -eq 0 || "${1:-}" == "ALL" ]]; then
    run_cmd docker compose down
  else
    run_cmd docker compose stop "$@"
  fi
}

action_migrate() {
  header "Run Migrations"
  run_cmd docker compose up -d postgres
  wait_postgres
  run_cmd docker compose --profile setup run --rm migrate
}

action_pipeline() {
  header "Run Pipeline"
  local env_string
  local env_args=()
  local line
  env_string="$(build_llm_env_args pipeline "$@")"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    env_args+=(-e "${line#-e }")
  done <<< "$env_string"
  run_cmd docker compose run --rm ${env_args[@]+"${env_args[@]}"} pipeline
}

action_recluster() {
  header "Recluster"
  local env_string
  local env_args=()
  local line
  env_string="$(build_llm_env_args recluster "$@")"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    env_args+=(-e "${line#-e }")
  done <<< "$env_string"
  run_cmd docker compose --profile recluster run --rm ${env_args[@]+"${env_args[@]}"} recluster
}

action_reembed() {
  header "Reembed Profiles"
  run_cmd docker compose --profile reembed run --rm reembed
}

action_resummarize() {
  header "Resummarize Profiles"
  local since_hours="24"
  local extra_env=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --since-hours) since_hours="${2:?Missing value for --since-hours}"; shift 2 ;;
      --env) extra_env+=(-e "${2:?Missing value for --env}"); shift 2 ;;
      *) echo "Unknown option for resummarize: $1" >&2; return 2 ;;
    esac
  done

  run_cmd docker compose --profile resummarize run --rm -e "SINCE_HOURS=${since_hours}" ${extra_env[@]+"${extra_env[@]}"} resummarize
}

action_diagnostics() {
  header "Run Diagnostics"
  run_cmd docker compose --profile recluster run --rm recluster node dist/diagnostics.js
}

action_logs() {
  header "View Logs"
  local service="${1:-ALL}"

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
  local no_cache=()
  [[ "${1:-}" == "--no-cache" ]] && no_cache=(--no-cache)

  echo "==> Building all containers..."
  run_cmd docker compose build ${no_cache[@]+"${no_cache[@]}"}

  echo "==> Starting infrastructure..."
  run_cmd docker compose up -d postgres redis batch-clusterer

  wait_postgres

  echo "==> Running migrations..."
  run_cmd docker compose --profile setup run --rm migrate

  echo "==> Starting app services..."
  run_cmd docker compose up -d api pipeline web

  wait_api
  echo "  API healthy."
  action_status
}

choose_model_preset() {
  local choices=()
  local entry preset model description

  for entry in "${MODEL_PRESETS[@]}"; do
    IFS='|' read -r preset model description <<< "$entry"
    choices+=("$preset - $description")
  done
  choices+=("custom")

  local selected
  selected="$(gum choose --header "Select model preset" "${choices[@]}")"
  if [[ "$selected" == "custom" ]]; then
    gum input --placeholder "Model id, e.g. google/gemma-4-26b-a4b-it"
  else
    echo "${selected%% - *}"
  fi
}

interactive_llm_options() {
  local target="$1"
  local args=()

  if gum confirm "Set LLM mode/provider?" --default=No; then
    local mode
    mode="$(gum choose --header "LLM mode" openrouter gemini-fallback)"
    args+=(--mode "$mode")
  fi

  if gum confirm "Set LLM model?" --default=No; then
    local model
    model="$(choose_model_preset)"
    args+=(--model "$model")
  fi

  if gum confirm "Set Google AI Studio fallback model?" --default=No; then
    local google_model
    google_model="$(choose_model_preset)"
    args+=(--google-model "$google_model")
  fi

  if [[ "$target" == "pipeline" ]]; then
    if gum confirm "Set LLM concurrency?" --default=No; then
      args+=(--llm-concurrency "$(gum input --value "${LLM_CONCURRENCY:-5}")")
    fi
    if gum confirm "Set embedding model/concurrency?" --default=No; then
      args+=(--embedding-model "$(gum input --value "${EMBEDDING_MODEL:-qwen/qwen3-embedding-8b}")")
      args+=(--embedding-concurrency "$(gum input --value "${EMBEDDING_CONCURRENCY:-15}")")
    fi
  fi

  if [[ "$target" == "recluster" ]]; then
    gum confirm "Disable cache (RECLUSTER_NO_CACHE=1)?" --default=No && args+=(--no-cache)
    if gum confirm "Set recluster concurrency?" --default=No; then
      args+=(--recluster-concurrency "$(gum input --value "${RECLUSTER_LLM_CONCURRENCY:-15}")")
    fi
    if gum confirm "Set merge threshold/max size?" --default=No; then
      args+=(--merge-threshold "$(gum input --value "${RECLUSTER_MERGE_THRESHOLD:-0.85}")")
      args+=(--merge-max-size "$(gum input --value "${RECLUSTER_MERGE_MAX_SIZE:-24}")")
    fi
  fi

  printf '%s\n' "${args[@]}"
}

interactive_build() {
  header "Build Containers"
  local buildable=()
  local svc
  while IFS= read -r svc; do
    [[ -n "$svc" ]] && buildable+=("$svc")
  done < <(buildable_services)

  local selected
  selected="$(gum choose --no-limit --header "Select services to build" "${buildable[@]}" "ALL")"
  [[ -z "$selected" ]] && { echo "  Nothing selected."; return; }

  local args=()
  local services=()
  gum confirm "Build with --no-cache?" --default=No && args+=(--no-cache)
  if echo "$selected" | grep -q "ALL"; then
    action_build "${args[@]}"
  else
    while IFS= read -r svc; do
      [[ -n "$svc" ]] && services+=("$svc")
    done <<< "$selected"
    action_build "${args[@]}" "${services[@]}"
  fi
}

interactive_start() {
  header "Start Services"
  local selected
  selected="$(gum choose --no-limit --header "Select services to start" "${STARTABLE_SERVICES[@]}" "ALL")"
  [[ -z "$selected" ]] && { echo "  Nothing selected."; return; }

  local svc
  local services=()
  if echo "$selected" | grep -q "ALL"; then
    action_start
  else
    while IFS= read -r svc; do
      [[ -n "$svc" ]] && services+=("$svc")
    done <<< "$selected"
    action_start "${services[@]}"
  fi
}

interactive_stop() {
  header "Stop Services"
  local running
  running="$(docker compose ps --services 2>/dev/null || true)"
  [[ -z "$running" ]] && { echo "  No services running."; return; }

  local selected
  selected="$(printf '%s\n' "$running" "ALL" | gum choose --no-limit --header "Select services to stop")"
  [[ -z "$selected" ]] && { echo "  Nothing selected."; return; }

  local svc
  local services=()
  if echo "$selected" | grep -q "ALL"; then
    action_stop ALL
  else
    while IFS= read -r svc; do
      [[ -n "$svc" ]] && services+=("$svc")
    done <<< "$selected"
    action_stop "${services[@]}"
  fi
}

interactive_pipeline() {
  local args=()
  local arg
  while IFS= read -r arg; do
    [[ -n "$arg" ]] && args+=("$arg")
  done < <(interactive_llm_options pipeline)
  action_pipeline "${args[@]}"
}

interactive_recluster() {
  local args=()
  local arg
  while IFS= read -r arg; do
    [[ -n "$arg" ]] && args+=("$arg")
  done < <(interactive_llm_options recluster)
  action_recluster "${args[@]}"
}

interactive_resummarize() {
  local since
  since="$(gum input --placeholder "SINCE_HOURS" --value "${SINCE_HOURS:-24}")"
  action_resummarize --since-hours "$since"
}

interactive_logs() {
  local running
  running="$(docker compose ps --services 2>/dev/null || true)"
  [[ -z "$running" ]] && { echo "  No services running."; return; }

  local service
  service="$(printf '%s\n' "$running" "ALL" | gum choose --header "Which service?")"
  action_logs "$service"
}

interactive_main() {
  require_gum

  local actions=(
    "Build containers"
    "Start services"
    "Stop services"
    "Full rebuild (build+migrate+start)"
    "Run migrations"
    "Run pipeline"
    "Recluster"
    "Reembed"
    "Resummarize"
    "Diagnostics"
    "Recommended models"
    "View logs"
    "Status"
    "Exit"
  )

  echo ""
  gum style --bold --foreground 212 "$PROJECT_NAME interactive build"
  echo ""

  while true; do
    local choice
    choice="$(gum choose --header "What do you want to do?" "${actions[@]}")"

    case "$choice" in
      "Build containers")                   interactive_build ;;
      "Start services")                     interactive_start ;;
      "Stop services")                      interactive_stop ;;
      "Full rebuild (build+migrate+start)") action_full_rebuild ;;
      "Run migrations")                     action_migrate ;;
      "Run pipeline")                       interactive_pipeline ;;
      "Recluster")                          interactive_recluster ;;
      "Reembed")                            action_reembed ;;
      "Resummarize")                        interactive_resummarize ;;
      "Diagnostics")                        action_diagnostics ;;
      "Recommended models")                 show_models ;;
      "View logs")                          interactive_logs ;;
      "Status")                             action_status ;;
      "Exit")                               echo ""; echo "Bye."; exit 0 ;;
    esac
  done
}

main() {
  local command="${1:-menu}"
  [[ $# -gt 0 ]] && shift || true

  case "$command" in
    menu) interactive_main ;;
    help|--help|-h) usage ;;
    models) show_models ;;
    build) action_build "$@" ;;
    start) action_start "$@" ;;
    stop) action_stop "$@" ;;
    rebuild) action_full_rebuild "$@" ;;
    migrate) action_migrate ;;
    pipeline) action_pipeline "$@" ;;
    recluster) action_recluster "$@" ;;
    reembed) action_reembed ;;
    resummarize) action_resummarize "$@" ;;
    diagnostics) action_diagnostics ;;
    logs) action_logs "$@" ;;
    status) action_status ;;
    *) echo "Unknown command: $command" >&2; usage >&2; return 2 ;;
  esac
}

if [[ "${BUILD_SH_TEST:-0}" != "1" ]]; then
  main "$@"
fi
