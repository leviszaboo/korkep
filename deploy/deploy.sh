#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PROJECT_NAME="groundnews"
DEFAULT_ENV_PROFILE="production"

resolve_env_file() {
  local profile="${1:-}"
  local explicit="${2:-}"

  if [[ -n "$explicit" ]]; then
    case "$explicit" in
      /*) echo "$explicit" ;;
      *) echo "${ROOT_DIR}/${explicit}" ;;
    esac
    return
  fi

  if [[ -z "$profile" ]]; then
    if [[ -n "${DEPLOY_ENV_FILE:-}" ]]; then
      case "$DEPLOY_ENV_FILE" in
        /*) echo "$DEPLOY_ENV_FILE" ;;
        *) echo "${ROOT_DIR}/${DEPLOY_ENV_FILE}" ;;
      esac
      return
    fi
    profile="$DEFAULT_ENV_PROFILE"
  fi

  if [[ ! "$profile" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "Invalid env profile: $profile" >&2
    return 2
  fi

  echo "${SCRIPT_DIR}/env.${profile}"
}

target_type() {
  case "$1" in
    api|batch-clusterer) echo "service" ;;
    migrate|pipeline|scrape|process|embed-cluster|recluster|reembed|resummarize|repair) echo "job" ;;
    *) echo "Unknown target: $1" >&2; return 2 ;;
  esac
}

target_image() {
  case "$1" in
    api) echo "api" ;;
    batch-clusterer) echo "batch-clusterer" ;;
    migrate) echo "api" ;;
    pipeline|scrape|process|embed-cluster|recluster|reembed|resummarize|repair) echo "workers" ;;
    *) echo "Unknown target: $1" >&2; return 2 ;;
  esac
}

job_command() {
  case "$1" in
    migrate) echo "dist/db/migrate.js" ;;
    pipeline) echo "dist/pipeline/pipeline-job.js" ;;
    scrape) echo "dist/pipeline/scrape-job.js" ;;
    process) echo "dist/pipeline/process-job.js" ;;
    embed-cluster) echo "dist/pipeline/embed-cluster-job.js" ;;
    recluster) echo "dist/recluster.js" ;;
    reembed) echo "dist/reembed.js" ;;
    resummarize) echo "dist/resummarize.js" ;;
    repair) echo "dist/repair.js" ;;
    *) echo "Unknown job: $1" >&2; return 2 ;;
  esac
}

secret_manager_name() {
  case "$1" in
    DATABASE_URL|database-url) echo "database-url" ;;
    OPENROUTER_API_KEY|openrouter-api-key) echo "openrouter-api-key" ;;
    REDIS_URL|upstash-redis-url) echo "upstash-redis-url" ;;
    GOOGLE_AI_STUDIO_API_KEY|google-ai-studio-key) echo "google-ai-studio-key" ;;
    *) echo "Unknown secret: $1" >&2; return 2 ;;
  esac
}

deploy_plan_for_target() {
  local target="$1"
  local tag="$2"
  local mode="${3:-build}"
  local image
  image="$(target_image "$target")"

  if [[ "$mode" == "build" ]]; then
    printf 'build_image %s %s\n' "$image" "$tag"
    printf 'push_image %s %s\n' "$image" "$tag"
  fi

  if [[ "$(target_type "$target")" == "service" ]]; then
    printf 'deploy_service_target %s %s\n' "$target" "$tag"
  else
    printf 'deploy_job_target %s %s\n' "$target" "$tag"
  fi
}

full_deploy_plan() {
  local tag="$1"
  local run_migrate="${2:-1}"
  local run_schedules="${3:-1}"

  printf 'build_image api %s\n' "$tag"
  printf 'build_image workers %s\n' "$tag"
  printf 'build_image batch-clusterer %s\n' "$tag"
  printf 'push_image api %s\n' "$tag"
  printf 'push_image workers %s\n' "$tag"
  printf 'push_image batch-clusterer %s\n' "$tag"
  printf 'deploy_service_target batch-clusterer %s\n' "$tag"
  printf 'deploy_service_target api %s\n' "$tag"
  local job
  for job in migrate pipeline scrape process embed-cluster recluster reembed resummarize repair; do
    printf 'deploy_job_target %s %s\n' "$job" "$tag"
  done
  [[ "$run_migrate" == "1" ]] && printf 'execute_job migrate\n'
  printf 'delete_obsolete_job scrape-pipeline\n'
  [[ "$run_schedules" == "1" ]] && printf 'deploy_schedules\n'
}

ENV_PROFILE=""
ENV_FILE_ARG=""
ENV_FILE=""
PROJECT_ID=""
REGION=""
REGISTRY=""
TAG=""
YES=0
NO_BUILD=0
NO_PUSH=0
RUN_MIGRATE=1
RUN_SCHEDULES=1
POSITIONAL=()

usage() {
  cat <<'EOF'
groundnews deploy helper

Usage:
  ./deploy/deploy.sh                         Open the interactive menu
  ./deploy/deploy.sh help                    Show this help
  ./deploy/deploy.sh full [options]          Build, push, deploy all, migrate, schedules
  ./deploy/deploy.sh deploy <target>         Build, push, and deploy one target
  ./deploy/deploy.sh config <target>         Update one target without build/push
  ./deploy/deploy.sh trigger <job> [KEY=VALUE ...]
  ./deploy/deploy.sh migrate                 Execute migrate job
  ./deploy/deploy.sh schedules               Create/update Cloud Scheduler jobs
  ./deploy/deploy.sh secret [name]           Store or rotate a Secret Manager value
  ./deploy/deploy.sh env                     Manage env profiles
  ./deploy/deploy.sh status                  Show Cloud Run services/jobs/schedulers
  ./deploy/deploy.sh diagnostics [options]   Run deploy/cloud-diagnostics.sh

Options:
  --env <name>          Use deploy/env.<name>
  --env-file <path>     Use an explicit env file
  --tag <tag>           Use an explicit image tag
  --no-build            For deploy: update config using current image
  --no-push             Build locally but do not push
  --no-migrate          For full: skip migrate execution
  --no-schedules        For full: skip scheduler updates
  --yes                 Skip confirmation prompts

Diagnostics options:
  --llm-lookback-days <days>  Override LLM usage graph/table lookback window

Targets:
  api batch-clusterer migrate pipeline scrape process embed-cluster recluster reembed resummarize repair
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
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

run_cmd_with_retries() {
  local attempts="$1"
  local delay_seconds="$2"
  shift 2

  local attempt=1
  while true; do
    if run_cmd "$@"; then
      return 0
    fi

    if [[ "$attempt" -ge "$attempts" ]]; then
      return 1
    fi

    echo "Command failed; retrying in ${delay_seconds}s (${attempt}/${attempts})..."
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
}

confirm_action() {
  local message="$1"
  if [[ "$YES" == "1" ]]; then
    return 0
  fi
  if command -v gum >/dev/null 2>&1; then
    gum confirm "$message" --default=No
  else
    local reply
    read -r -p "${message} [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]]
  fi
}

is_production_profile() {
  [[ "${ENV_FILE}" == *production* || "${ENV_PROFILE}" == *production* ]]
}

confirm_production_target() {
  local action="$1"
  if is_production_profile; then
    confirm_action "${action} using ${ENV_FILE}?"
  fi
}

load_env() {
  ENV_FILE="$(resolve_env_file "$ENV_PROFILE" "$ENV_FILE_ARG")"
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing deploy env file: ${ENV_FILE}" >&2
    echo "Copy deploy/env.production.example to deploy/env.production and fill it in." >&2
    exit 1
  fi

  set -a
  . "$ENV_FILE"
  set +a

  PROJECT_ID="${GCP_PROJECT_ID:?GCP_PROJECT_ID is required in ${ENV_FILE}}"
  REGION="${GCP_REGION:?GCP_REGION is required in ${ENV_FILE}}"
  REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY_REPOSITORY:?ARTIFACT_REGISTRY_REPOSITORY is required in ${ENV_FILE}}"
  TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
}

parse_global_options() {
  POSITIONAL=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env) ENV_PROFILE="${2:?Missing value for --env}"; shift 2 ;;
      --env-file) ENV_FILE_ARG="${2:?Missing value for --env-file}"; shift 2 ;;
      --tag) TAG="${2:?Missing value for --tag}"; shift 2 ;;
      --no-build) NO_BUILD=1; shift ;;
      --no-push) NO_PUSH=1; shift ;;
      --no-migrate) RUN_MIGRATE=0; shift ;;
      --no-schedules) RUN_SCHEDULES=0; shift ;;
      --yes) YES=1; shift ;;
      --) shift; while [[ $# -gt 0 ]]; do POSITIONAL+=("$1"); shift; done ;;
      *) POSITIONAL+=("$1"); shift ;;
    esac
  done
}

image_context() {
  case "$1" in
    api|workers) echo "." ;;
    batch-clusterer) echo "apps/batch-clusterer" ;;
    *) echo "Unknown image: $1" >&2; return 2 ;;
  esac
}

image_dockerfile() {
  case "$1" in
    api) echo "apps/api/Dockerfile" ;;
    workers) echo "apps/workers/Dockerfile" ;;
    batch-clusterer) echo "apps/batch-clusterer/Dockerfile" ;;
    *) echo "Unknown image: $1" >&2; return 2 ;;
  esac
}

image_uri() {
  local image="$1"
  local tag="${2:-$TAG}"
  echo "${REGISTRY}/${image}:${tag}"
}

build_image() {
  local image="$1"
  local tag="${2:-$TAG}"
  header "Build ${image}"
  run_cmd docker build --platform linux/amd64 -t "$(image_uri "$image" "$tag")" -f "$(image_dockerfile "$image")" "$(image_context "$image")"
}

push_image() {
  local image="$1"
  local tag="${2:-$TAG}"
  header "Push ${image}"
  run_cmd_with_retries 3 5 docker push "$(image_uri "$image" "$tag")"
}

deploy_service_target() {
  local target="$1"
  local tag="${2:-$TAG}"

  case "$target" in
    batch-clusterer)
      header "Deploy batch-clusterer"
      run_cmd gcloud run deploy batch-clusterer \
        --image="$(image_uri batch-clusterer "$tag")" \
        --region="$REGION" \
        --platform=managed \
        --memory="$BATCH_CLUSTERER_MEMORY" \
        --cpu="$BATCH_CLUSTERER_CPU" \
        --min-instances="$BATCH_CLUSTERER_MIN_INSTANCES" \
        --max-instances="$BATCH_CLUSTERER_MAX_INSTANCES" \
        --timeout="$BATCH_CLUSTERER_TIMEOUT_SECONDS" \
        --no-allow-unauthenticated \
        --port=8101 \
        --set-env-vars="HDBSCAN_MAX_CLUSTER_SIZE=${HDBSCAN_MAX_CLUSTER_SIZE},HDBSCAN_TIME_WEIGHT=${HDBSCAN_TIME_WEIGHT},HDBSCAN_TIME_SCALE_HOURS=${HDBSCAN_TIME_SCALE_HOURS},HDBSCAN_MIN_SAMPLES=${HDBSCAN_MIN_SAMPLES},HDBSCAN_CLUSTER_SELECTION_EPSILON=${HDBSCAN_CLUSTER_SELECTION_EPSILON},HDBSCAN_UMAP_COMPONENTS=${HDBSCAN_UMAP_COMPONENTS},HDBSCAN_UMAP_NEIGHBORS=${HDBSCAN_UMAP_NEIGHBORS},HDBSCAN_UMAP_MIN_ARTICLES=${HDBSCAN_UMAP_MIN_ARTICLES}"
      ;;
    api)
      header "Deploy api"
      run_cmd gcloud run deploy api \
        --image="$(image_uri api "$tag")" \
        --region="$REGION" \
        --platform=managed \
        --memory="$API_MEMORY" \
        --cpu="$API_CPU" \
        --min-instances="$API_MIN_INSTANCES" \
        --max-instances="$API_MAX_INSTANCES" \
        --timeout="$API_TIMEOUT_SECONDS" \
        --allow-unauthenticated \
        --port=3001 \
        --set-secrets="DATABASE_URL=database-url:latest" \
        --set-env-vars="HOST=0.0.0.0,CORS_ORIGIN=${API_CORS_ORIGIN},RATE_LIMIT_ENABLED=${RATE_LIMIT_ENABLED},RATE_LIMIT_MAX=${RATE_LIMIT_MAX},SEARCH_RATE_LIMIT_MAX=${SEARCH_RATE_LIMIT_MAX},RATE_LIMIT_WINDOW_SECONDS=${RATE_LIMIT_WINDOW_SECONDS}"
      ;;
    *) echo "Unknown service target: $target" >&2; return 2 ;;
  esac
}

service_url() {
  local service="$1"
  gcloud run services describe "$service" --region="$REGION" --format='value(status.url)'
}

worker_secrets() {
  echo "DATABASE_URL=database-url:latest,OPENROUTER_API_KEY=openrouter-api-key:latest"
}

job_secrets() {
  case "$1" in
    migrate) echo "DATABASE_URL=database-url:latest" ;;
    pipeline|scrape|process|embed-cluster) echo "$(worker_secrets),REDIS_URL=upstash-redis-url:latest" ;;
    recluster|reembed|resummarize|repair) worker_secrets ;;
    *) echo "Unknown job: $1" >&2; return 2 ;;
  esac
}

cluster_env() {
  local clusterer_url="$1"
  echo "BATCH_CLUSTERER_URL=${clusterer_url},CLUSTER_SIMILARITY_THRESHOLD=${CLUSTER_SIMILARITY_THRESHOLD},CLUSTER_TIME_WINDOW_HOURS=${CLUSTER_TIME_WINDOW_HOURS},CLUSTER_MAX_SIZE=${CLUSTER_MAX_SIZE},CLUSTER_MIN_COHERENCE=${CLUSTER_MIN_COHERENCE},CLUSTER_ENTITY_WEIGHT=${CLUSTER_ENTITY_WEIGHT},CLUSTER_SEMANTIC_WEIGHT=${CLUSTER_SEMANTIC_WEIGHT},CLUSTER_TOKEN_WEIGHT=${CLUSTER_TOKEN_WEIGHT}"
}

job_env_vars() {
  local job="$1"
  local clusterer_url="${2:-}"
  case "$job" in
    migrate) echo "" ;;
    pipeline) echo "SCRAPE_CONCURRENCY=${SCRAPE_CONCURRENCY},SCRAPE_EXTRACT_CONCURRENCY=${SCRAPE_EXTRACT_CONCURRENCY},LLM_CONCURRENCY=${LLM_CONCURRENCY},LLM_PROVIDER=${LLM_PROVIDER},LLM_MODEL=${LLM_MODEL},$(cluster_env "$clusterer_url"),EMBEDDING_CONCURRENCY=${EMBEDDING_CONCURRENCY},EMBEDDING_MODEL=${EMBEDDING_MODEL},STORY_ASSIGN_CONCURRENCY=${STORY_ASSIGN_CONCURRENCY:-2},STORY_ASSIGN_LOOKBACK_HOURS=${STORY_ASSIGN_LOOKBACK_HOURS:-24},TRIGGER_MODE=scheduled,NEXT_JOB=" ;;
    scrape) echo "SCRAPE_CONCURRENCY=${SCRAPE_CONCURRENCY},SCRAPE_EXTRACT_CONCURRENCY=${SCRAPE_EXTRACT_CONCURRENCY},NEXT_JOB=process,TRIGGER_MODE=scheduled" ;;
    process) echo "LLM_CONCURRENCY=${LLM_CONCURRENCY},LLM_PROVIDER=${LLM_PROVIDER},LLM_MODEL=${LLM_MODEL},NEXT_JOB=embed-cluster,TRIGGER_MODE=scheduled" ;;
    embed-cluster) echo "$(cluster_env "$clusterer_url"),EMBEDDING_CONCURRENCY=${EMBEDDING_CONCURRENCY},EMBEDDING_MODEL=${EMBEDDING_MODEL},STORY_ASSIGN_CONCURRENCY=${STORY_ASSIGN_CONCURRENCY:-2},STORY_ASSIGN_LOOKBACK_HOURS=${STORY_ASSIGN_LOOKBACK_HOURS:-24},TRIGGER_MODE=scheduled" ;;
    recluster) echo "BATCH_CLUSTERER_URL=${clusterer_url},RECLUSTER_SEED_HOURS=${RECLUSTER_SEED_HOURS:-2},RECLUSTER_NO_CACHE=${RECLUSTER_NO_CACHE},RECLUSTER_MERGE_THRESHOLD=${RECLUSTER_MERGE_THRESHOLD},RECLUSTER_MERGE_MAX_SIZE=${RECLUSTER_MERGE_MAX_SIZE},RECLUSTER_LLM_PROVIDER=${RECLUSTER_LLM_PROVIDER},RECLUSTER_LLM_MODEL=${RECLUSTER_LLM_MODEL},RECLUSTER_LLM_CONCURRENCY=${RECLUSTER_LLM_CONCURRENCY},TRIGGER_MODE=scheduled" ;;
    reembed) echo "" ;;
    resummarize) echo "SINCE_HOURS=24" ;;
    repair) echo "REPAIR_LOOKBACK_HOURS=${REPAIR_LOOKBACK_HOURS},REPAIR_MAX_ARTICLES=${REPAIR_MAX_ARTICLES},REPAIR_MAX_STORIES=${REPAIR_MAX_STORIES},REPAIR_ANALYSIS_CONCURRENCY=${REPAIR_ANALYSIS_CONCURRENCY},REPAIR_EMBEDDING_BATCH_SIZE=${REPAIR_EMBEDDING_BATCH_SIZE},REPAIR_GRACE_MINUTES=${REPAIR_GRACE_MINUTES},TRIGGER_MODE=scheduled" ;;
    *) echo "Unknown job: $job" >&2; return 2 ;;
  esac
}

job_memory() {
  local upper
  upper="$(echo "$1" | tr '[:lower:]-' '[:upper:]_')"
  local name="${upper}_MEMORY"
  echo "${!name}"
}

job_cpu() {
  local upper
  upper="$(echo "$1" | tr '[:lower:]-' '[:upper:]_')"
  local name="${upper}_CPU"
  echo "${!name}"
}

job_timeout() {
  case "$1" in
    migrate) echo "120" ;;
    pipeline) echo "${PIPELINE_TIMEOUT_SECONDS:-1800}" ;;
    scrape|embed-cluster|recluster|repair) echo "600" ;;
    process) echo "1200" ;;
    reembed|resummarize) echo "3600" ;;
    *) echo "Unknown job: $1" >&2; return 2 ;;
  esac
}

needs_clusterer_url() {
  case "$1" in
    pipeline|embed-cluster|recluster) return 0 ;;
    *) return 1 ;;
  esac
}

resolve_clusterer_url_for_job() {
  local job="$1"
  if needs_clusterer_url "$job"; then
    local url
    url="$(service_url batch-clusterer)"
    if [[ -z "$url" ]]; then
      echo "batch-clusterer service does not exist or has no URL. Deploy batch-clusterer first." >&2
      return 1
    fi
    echo "$url"
  fi
}

deploy_job_target() {
  local job="$1"
  local tag="${2:-$TAG}"
  local image
  local clusterer_url=""
  local env_vars
  image="$(target_image "$job")"
  clusterer_url="$(resolve_clusterer_url_for_job "$job")"
  env_vars="$(job_env_vars "$job" "$clusterer_url")"

  local cmd_args=(
    --image="$(image_uri "$image" "$tag")"
    --region="$REGION"
    --memory="$(job_memory "$job")"
    --cpu="$(job_cpu "$job")"
    --task-timeout="$(job_timeout "$job")"
    --max-retries=1
    --set-secrets="$(job_secrets "$job")"
    --command="node"
    --args="$(job_command "$job")"
  )
  if [[ -n "$env_vars" ]]; then
    cmd_args+=(--set-env-vars="$env_vars")
  fi

  header "Deploy job ${job}"
  if gcloud run jobs describe "$job" --region="$REGION" &>/dev/null; then
    run_cmd gcloud run jobs update "$job" "${cmd_args[@]}"
  else
    run_cmd gcloud run jobs create "$job" "${cmd_args[@]}"
  fi
}

action_deploy_target() {
  local target="$1"
  load_env
  require_cmd gcloud
  if [[ "$NO_BUILD" != "1" ]]; then
    require_cmd docker
  fi
  confirm_production_target "Deploy ${target}" || { echo "Cancelled."; return 0; }

  local image
  image="$(target_image "$target")"
  if [[ "$NO_BUILD" != "1" ]]; then
    build_image "$image" "$TAG"
    if [[ "$NO_PUSH" != "1" ]]; then
      push_image "$image" "$TAG"
    fi
  fi

  if [[ "$(target_type "$target")" == "service" ]]; then
    deploy_service_target "$target" "$TAG"
    echo "  ${target}: $(service_url "$target")"
  else
    deploy_job_target "$target" "$TAG"
    echo "  ${target}: ok"
  fi
}

action_config_target() {
  local target="$1"
  NO_BUILD=1
  action_deploy_target "$target"
}

action_full() {
  load_env
  require_cmd docker
  require_cmd gcloud
  confirm_action "Run full deploy using ${ENV_FILE}?" || { echo "Cancelled."; return 0; }

  header "Full Deploy (${TAG})"
  build_image api "$TAG"
  build_image workers "$TAG"
  build_image batch-clusterer "$TAG"

  if [[ "$NO_PUSH" != "1" ]]; then
    push_image api "$TAG"
    push_image workers "$TAG"
    push_image batch-clusterer "$TAG"
  fi

  deploy_service_target batch-clusterer "$TAG"
  local clusterer_url
  clusterer_url="$(service_url batch-clusterer)"
  echo "  batch-clusterer: ${clusterer_url}"

  deploy_service_target api "$TAG"
  local api_url
  api_url="$(service_url api)"
  echo "  api: ${api_url}"

  local job
  for job in migrate pipeline scrape process embed-cluster recluster reembed resummarize repair; do
    deploy_job_target "$job" "$TAG"
  done

  if [[ "$RUN_MIGRATE" == "1" ]]; then
    execute_job migrate
  fi

  delete_obsolete_job scrape-pipeline

  if [[ "$RUN_SCHEDULES" == "1" ]]; then
    deploy_schedules
  fi

  print_deploy_summary "$api_url" "$clusterer_url"
}

execute_job() {
  local job="$1"
  load_env
  require_cmd gcloud
  header "Execute job ${job}"
  run_cmd gcloud run jobs execute "$job" --region="$REGION" --wait
}

action_trigger() {
  local job="$1"
  shift || true
  load_env
  require_cmd gcloud
  case "$job" in
    pipeline|scrape|process|embed-cluster|recluster|reembed|resummarize|repair|migrate) ;;
    *) echo "Unknown job: ${job}" >&2; return 2 ;;
  esac

  local extra_vars="TRIGGER_MODE=manual"
  if [[ $# -gt 0 ]]; then
    extra_vars="${extra_vars},$(IFS=,; echo "$*")"
  fi

  header "Trigger ${job}"
  echo "  Env overrides: ${extra_vars}"
  run_cmd gcloud run jobs execute "$job" --region="$REGION" "--update-env-vars=${extra_vars}" --wait
}

delete_obsolete_job() {
  local job="$1"
  if gcloud run jobs describe "$job" --region="$REGION" &>/dev/null; then
    header "Delete obsolete job ${job}"
    run_cmd gcloud run jobs delete "$job" --region="$REGION" --quiet
  fi
}

deploy_schedules() {
  load_env
  require_cmd gcloud
  confirm_action "Update Cloud Scheduler jobs using ${ENV_FILE}?" || { echo "Cancelled."; return 0; }

  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  JOBS_API="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs"

  delete_schedule_if_exists "repair-trigger"
  create_or_update_schedule "scrape-trigger" "$SCRAPE_DAY_SCHEDULE" "pipeline"
  create_or_update_schedule "scrape-night-trigger" "$SCRAPE_NIGHT_SCHEDULE" "pipeline"
  create_or_update_schedule "recluster-trigger" "$RECLUSTER_SCHEDULE" "recluster"
}

create_or_update_schedule() {
  local name="$1"
  local schedule="$2"
  local job="$3"

  if gcloud scheduler jobs describe "$name" --location="$REGION" &>/dev/null; then
    run_cmd gcloud scheduler jobs update http "$name" \
      --location="$REGION" \
      --schedule="$schedule" \
      --time-zone="$SCHEDULER_TIME_ZONE" \
      --uri="${JOBS_API}/${job}:run"
  else
    run_cmd gcloud scheduler jobs create http "$name" \
      --location="$REGION" \
      --schedule="$schedule" \
      --time-zone="$SCHEDULER_TIME_ZONE" \
      --uri="${JOBS_API}/${job}:run" \
      --http-method=POST \
      --oauth-service-account-email="$SA"
  fi
  echo "  ${name}: ${schedule} targeting ${job}"
}

delete_schedule_if_exists() {
  local name="$1"
  if gcloud scheduler jobs describe "$name" --location="$REGION" &>/dev/null; then
    run_cmd gcloud scheduler jobs delete "$name" --location="$REGION" --quiet
  fi
}

print_deploy_summary() {
  local api_url="$1"
  local clusterer_url="$2"
  echo ""
  echo "=== Deployment complete ==="
  echo ""
  echo "Cloud Run services:"
  echo "  API:             ${api_url}"
  echo "  Batch Clusterer: ${clusterer_url} (internal)"
  echo ""
  echo "Pipeline jobs:"
  echo "  scheduled:       pipeline (scrape -> process -> embed-cluster in one container)"
  echo "  manual/debug:    scrape -> process -> embed-cluster"
  echo ""
  echo "Manual jobs:"
  echo "  ./deploy/deploy.sh trigger scrape"
  echo "  ./deploy/deploy.sh trigger process"
  echo "  ./deploy/deploy.sh trigger embed-cluster"
  echo "  ./deploy/deploy.sh trigger recluster"
  echo "  ./deploy/deploy.sh trigger reembed"
  echo "  ./deploy/deploy.sh trigger resummarize SINCE_HOURS=48"
  echo "  ./deploy/deploy.sh trigger repair"
}

project_number() {
  gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'
}

grant_secret_access() {
  local secret="$1"
  local project_number_value
  project_number_value="$(project_number)"
  local sa="${project_number_value}-compute@developer.gserviceaccount.com"
  run_cmd gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${sa}" \
    --role="roles/secretmanager.secretAccessor"
}

store_secret_value() {
  local secret="$1"
  local value="$2"
  if gcloud secrets describe "$secret" &>/dev/null; then
    printf '%s' "$value" | gcloud secrets versions add "$secret" --data-file=-
  else
    printf '%s' "$value" | gcloud secrets create "$secret" --data-file=-
  fi
  grant_secret_access "$secret"
}

action_secret() {
  local input="${1:-}"
  load_env
  require_cmd gcloud
  local secret
  if [[ -n "$input" ]]; then
    secret="$(secret_manager_name "$input")"
  else
    require_gum
    secret="$(gum choose --header "Secret" database-url openrouter-api-key upstash-redis-url google-ai-studio-key)"
  fi

  local value
  if command -v gum >/dev/null 2>&1; then
    value="$(gum input --password --placeholder "New value for ${secret}")"
  else
    read -r -s -p "New value for ${secret}: " value
    echo ""
  fi
  [[ -n "$value" ]] || { echo "Secret value cannot be empty." >&2; return 2; }
  confirm_action "Store new version for ${secret} in ${PROJECT_ID}?" || { echo "Cancelled."; return 0; }
  store_secret_value "$secret" "$value"
  echo "  ${secret}: stored"
}

list_env_profiles() {
  local file
  for file in "${SCRIPT_DIR}"/env.*; do
    [[ -f "$file" ]] || continue
    basename "$file" | sed 's/^env\.//'
  done
}

validate_loaded_env() {
  local missing=0
  local name
  for name in GCP_PROJECT_ID GCP_REGION ARTIFACT_REGISTRY_REPOSITORY; do
    if [[ -z "${!name:-}" ]]; then
      echo "Missing required variable: $name" >&2
      missing=1
    fi
  done
  [[ "$missing" == "0" ]]
}

action_env() {
  require_gum
  local choice
  choice="$(gum choose --header "Env profiles" "List profiles" "Validate current profile" "Create from example" "Copy profile")"
  case "$choice" in
    "List profiles")
      list_env_profiles
      ;;
    "Validate current profile")
      load_env
      validate_loaded_env
      echo "  file:    ${ENV_FILE}"
      echo "  project: ${PROJECT_ID}"
      echo "  region:  ${REGION}"
      echo "  registry:${REGISTRY}"
      ;;
    "Create from example")
      local name target
      name="$(gum input --placeholder "profile name, e.g. staging")"
      target="$(resolve_env_file "$name" "")"
      [[ -e "$target" ]] && { echo "Profile exists: $target" >&2; return 2; }
      cp "${SCRIPT_DIR}/env.production.example" "$target"
      echo "  created ${target}"
      ;;
    "Copy profile")
      local from to source target
      from="$(list_env_profiles | gum choose --header "Copy from")"
      to="$(gum input --placeholder "new profile name")"
      source="$(resolve_env_file "$from" "")"
      target="$(resolve_env_file "$to" "")"
      [[ -e "$target" ]] && { echo "Profile exists: $target" >&2; return 2; }
      cp "$source" "$target"
      echo "  copied ${from} -> ${to}"
      ;;
  esac
}

action_status() {
  load_env
  require_cmd gcloud
  header "Cloud Run services"
  gcloud run services list --region="$REGION"
  header "Cloud Run jobs"
  gcloud run jobs list --region="$REGION"
  header "Cloud Scheduler"
  gcloud scheduler jobs list --location="$REGION"
}

action_diagnostics() {
  load_env
  DEPLOY_ENV_FILE="$ENV_FILE" "${SCRIPT_DIR}/cloud-diagnostics.sh" "$@"
}

TARGETS=(api batch-clusterer migrate pipeline scrape process embed-cluster recluster reembed resummarize repair)
JOBS=(migrate pipeline scrape process embed-cluster recluster reembed resummarize repair)

choose_target() {
  gum choose --header "Target" \
    "api              Cloud Run API service" \
    "batch-clusterer  internal HDBSCAN service" \
    "migrate          database migrations job" \
    "pipeline         combined scheduled scrape/process/embed job" \
    "scrape           fetch sources and enqueue processing" \
    "process          LLM article analysis" \
    "embed-cluster    embedding and story assignment" \
    "recluster        batch HDBSCAN reclustering" \
    "reembed          regenerate embeddings" \
    "resummarize      rerun recent article analysis" \
    "repair           bounded missing-data repair" | awk '{print $1}'
}

choose_job() {
  gum choose --header "Job" "${JOBS[@]}"
}

interactive_deploy_target() {
  local target
  target="$(choose_target)"
  [[ -n "$target" ]] && action_deploy_target "$target"
}

interactive_config_target() {
  local target
  target="$(choose_target)"
  [[ -n "$target" ]] && action_config_target "$target"
}

interactive_trigger() {
  local job
  job="$(choose_job)"
  [[ -n "$job" ]] || return 0
  local overrides=()
  if gum confirm "Add env overrides?" --default=No; then
    while true; do
      local item
      item="$(gum input --placeholder "KEY=VALUE, empty to finish")"
      [[ -z "$item" ]] && break
      overrides+=("$item")
    done
  fi
  action_trigger "$job" "${overrides[@]}"
}

interactive_main() {
  require_gum
  local actions=(
    "Full deploy"
    "Deploy one target"
    "Update config only"
    "Trigger job"
    "Run migration"
    "Manage schedules"
    "Manage secrets"
    "Manage env profiles"
    "Cloud status"
    "Cloud diagnostics"
    "Help"
    "Exit"
  )

  echo ""
  gum style --bold --foreground 212 "$PROJECT_NAME interactive deploy"
  echo ""

  while true; do
    local choice
    choice="$(gum choose --header "What do you want to do?" "${actions[@]}")"
    case "$choice" in
      "Full deploy") action_full ;;
      "Deploy one target") interactive_deploy_target ;;
      "Update config only") interactive_config_target ;;
      "Trigger job") interactive_trigger ;;
      "Run migration") execute_job migrate ;;
      "Manage schedules") deploy_schedules ;;
      "Manage secrets") action_secret ;;
      "Manage env profiles") action_env ;;
      "Cloud status") action_status ;;
      "Cloud diagnostics") action_diagnostics ;;
      "Help") usage ;;
      "Exit") echo ""; echo "Bye."; exit 0 ;;
    esac
  done
}

main() {
  parse_global_options "$@"
  set -- "${POSITIONAL[@]+"${POSITIONAL[@]}"}"

  local command="${1:-menu}"
  [[ $# -gt 0 ]] && shift || true

  case "$command" in
    menu) interactive_main ;;
    help|--help|-h) usage ;;
    full) action_full ;;
    deploy)
      [[ $# -ge 1 ]] || { echo "Missing target." >&2; usage >&2; return 2; }
      action_deploy_target "$1"
      ;;
    config)
      [[ $# -ge 1 ]] || { echo "Missing target." >&2; usage >&2; return 2; }
      action_config_target "$1"
      ;;
    trigger)
      [[ $# -ge 1 ]] || { echo "Missing job." >&2; usage >&2; return 2; }
      local job="$1"
      shift
      action_trigger "$job" "$@"
      ;;
    migrate) execute_job migrate ;;
    schedules) deploy_schedules ;;
    secret) action_secret "${1:-}" ;;
    env) action_env ;;
    status) action_status ;;
    diagnostics) action_diagnostics "$@" ;;
    *) echo "Unknown command: $command" >&2; usage >&2; return 2 ;;
  esac
}

if [[ "${DEPLOY_SH_TEST:-0}" != "1" ]]; then
  main "$@"
fi
