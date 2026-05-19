#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-${SCRIPT_DIR}/env.production}"
if [ ! -f "$ENV_FILE" ]; then
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
TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)

echo "=== Deploying Korkep (tag: ${TAG}) ==="
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 1: Build & push Docker images
# ─────────────────────────────────────────────────────────────────

echo "Building images..."

docker build --platform linux/amd64 -t "${REGISTRY}/api:${TAG}" \
  -f apps/api/Dockerfile . &
API_BUILD_PID=$!

docker build --platform linux/amd64 -t "${REGISTRY}/workers:${TAG}" \
  -f apps/workers/Dockerfile . &
WORKERS_BUILD_PID=$!

docker build --platform linux/amd64 -t "${REGISTRY}/batch-clusterer:${TAG}" \
  -f apps/batch-clusterer/Dockerfile apps/batch-clusterer &
CLUSTERER_BUILD_PID=$!

wait $API_BUILD_PID $WORKERS_BUILD_PID $CLUSTERER_BUILD_PID
echo "All images built."

echo "Pushing images..."
docker push "${REGISTRY}/api:${TAG}" &
docker push "${REGISTRY}/workers:${TAG}" &
docker push "${REGISTRY}/batch-clusterer:${TAG}" &
wait
echo "All images pushed."

# ─────────────────────────────────────────────────────────────────
# Step 2: Deploy Cloud Run services
# ─────────────────────────────────────────────────────────────────

echo ""
echo "Deploying Cloud Run services..."

# batch-clusterer (internal only, not publicly accessible)
gcloud run deploy batch-clusterer \
  --image="${REGISTRY}/batch-clusterer:${TAG}" \
  --region="$REGION" \
  --platform=managed \
  --memory="$BATCH_CLUSTERER_MEMORY" \
  --cpu="$BATCH_CLUSTERER_CPU" \
  --min-instances="$BATCH_CLUSTERER_MIN_INSTANCES" \
  --max-instances="$BATCH_CLUSTERER_MAX_INSTANCES" \
  --timeout="$BATCH_CLUSTERER_TIMEOUT_SECONDS" \
  --no-allow-unauthenticated \
  --port=8101 \
  --set-env-vars="\
HDBSCAN_MAX_CLUSTER_SIZE=${HDBSCAN_MAX_CLUSTER_SIZE},\
HDBSCAN_TIME_WEIGHT=${HDBSCAN_TIME_WEIGHT},\
HDBSCAN_TIME_SCALE_HOURS=${HDBSCAN_TIME_SCALE_HOURS},\
HDBSCAN_MIN_SAMPLES=${HDBSCAN_MIN_SAMPLES},\
HDBSCAN_CLUSTER_SELECTION_EPSILON=${HDBSCAN_CLUSTER_SELECTION_EPSILON},\
HDBSCAN_UMAP_COMPONENTS=${HDBSCAN_UMAP_COMPONENTS},\
HDBSCAN_UMAP_NEIGHBORS=${HDBSCAN_UMAP_NEIGHBORS},\
HDBSCAN_UMAP_MIN_ARTICLES=${HDBSCAN_UMAP_MIN_ARTICLES}"

CLUSTERER_URL=$(gcloud run services describe batch-clusterer \
  --region="$REGION" --format='value(status.url)')
echo "  batch-clusterer: ${CLUSTERER_URL}"

# api (public)
gcloud run deploy api \
  --image="${REGISTRY}/api:${TAG}" \
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

API_URL=$(gcloud run services describe api \
  --region="$REGION" --format='value(status.url)')
echo "  api: ${API_URL}"

# ─────────────────────────────────────────────────────────────────
# Step 3: Deploy Cloud Run Jobs
# ─────────────────────────────────────────────────────────────────

echo ""
echo "Deploying Cloud Run Jobs..."

WORKER_SECRETS="DATABASE_URL=database-url:latest,OPENROUTER_API_KEY=openrouter-api-key:latest"
# To re-enable Gemini with OpenRouter fallback, append:
#   WORKER_SECRETS="${WORKER_SECRETS},GOOGLE_AI_STUDIO_API_KEY=google-ai-studio-key:latest"
CLUSTER_ENV="\
BATCH_CLUSTERER_URL=${CLUSTERER_URL},\
CLUSTER_SIMILARITY_THRESHOLD=${CLUSTER_SIMILARITY_THRESHOLD},\
CLUSTER_TIME_WINDOW_HOURS=${CLUSTER_TIME_WINDOW_HOURS},\
CLUSTER_MAX_SIZE=${CLUSTER_MAX_SIZE},\
CLUSTER_MIN_COHERENCE=${CLUSTER_MIN_COHERENCE},\
CLUSTER_ENTITY_WEIGHT=${CLUSTER_ENTITY_WEIGHT},\
CLUSTER_SEMANTIC_WEIGHT=${CLUSTER_SEMANTIC_WEIGHT},\
CLUSTER_TOKEN_WEIGHT=${CLUSTER_TOKEN_WEIGHT}"

deploy_job() {
  local name="$1" image="$2" timeout="$3" command="$4" secrets="$5" env_vars="$6" memory="$7" cpu="$8"

  local cmd_args=(
    --image="$image"
    --region="$REGION"
    --memory="$memory"
    --cpu="$cpu"
    --task-timeout="$timeout"
    --max-retries=1
    --set-secrets="$secrets"
    --command="node"
    --args="$command"
  )
  if [ -n "$env_vars" ]; then
    cmd_args+=(--set-env-vars="$env_vars")
  fi

  if gcloud run jobs describe "$name" --region="$REGION" &>/dev/null; then
    gcloud run jobs update "$name" "${cmd_args[@]}"
  else
    gcloud run jobs create "$name" "${cmd_args[@]}"
  fi
  echo "  ${name}: ok (${memory}, ${cpu} CPU)"
}

# migrate — runs DB migrations (uses api image)
deploy_job "migrate" \
  "${REGISTRY}/api:${TAG}" \
  "120" \
  "dist/db/migrate.js" \
  "DATABASE_URL=database-url:latest" \
  "" \
  "$MIGRATE_MEMORY" \
  "$MIGRATE_CPU"

UPSTASH_SECRET="REDIS_URL=upstash-redis-url:latest"

# scrape — fetch RSS, dedup, insert raw, push to queue
deploy_job "scrape" \
  "${REGISTRY}/workers:${TAG}" \
  "600" \
  "dist/pipeline/scrape-job.js" \
  "${WORKER_SECRETS},${UPSTASH_SECRET}" \
  "SCRAPE_CONCURRENCY=${SCRAPE_CONCURRENCY},SCRAPE_EXTRACT_CONCURRENCY=${SCRAPE_EXTRACT_CONCURRENCY},NEXT_JOB=process,TRIGGER_MODE=scheduled" \
  "$SCRAPE_MEMORY" \
  "$SCRAPE_CPU"

# process — LLM article labeling
deploy_job "process" \
  "${REGISTRY}/workers:${TAG}" \
  "1200" \
  "dist/pipeline/process-job.js" \
  "${WORKER_SECRETS},${UPSTASH_SECRET}" \
  "LLM_CONCURRENCY=${LLM_CONCURRENCY},LLM_PROVIDER=${LLM_PROVIDER},LLM_MODEL=${LLM_MODEL},NEXT_JOB=embed-cluster,TRIGGER_MODE=scheduled" \
  "$PROCESS_MEMORY" \
  "$PROCESS_CPU"

# embed-cluster — embed + assign story
deploy_job "embed-cluster" \
  "${REGISTRY}/workers:${TAG}" \
  "600" \
  "dist/pipeline/embed-cluster-job.js" \
  "${WORKER_SECRETS},${UPSTASH_SECRET}" \
  "${CLUSTER_ENV},EMBEDDING_CONCURRENCY=${EMBEDDING_CONCURRENCY},EMBEDDING_MODEL=${EMBEDDING_MODEL},TRIGGER_MODE=scheduled" \
  "$EMBED_CLUSTER_MEMORY" \
  "$EMBED_CLUSTER_CPU"

# recluster — HDBSCAN batch re-clustering
deploy_job "recluster" \
  "${REGISTRY}/workers:${TAG}" \
  "600" \
  "dist/recluster.js" \
  "$WORKER_SECRETS" \
  "BATCH_CLUSTERER_URL=${CLUSTERER_URL},RECLUSTER_NO_CACHE=${RECLUSTER_NO_CACHE},RECLUSTER_MERGE_THRESHOLD=${RECLUSTER_MERGE_THRESHOLD},RECLUSTER_MERGE_MAX_SIZE=${RECLUSTER_MERGE_MAX_SIZE},RECLUSTER_LLM_PROVIDER=${RECLUSTER_LLM_PROVIDER},RECLUSTER_LLM_CONCURRENCY=${RECLUSTER_LLM_CONCURRENCY},TRIGGER_MODE=scheduled" \
  "$RECLUSTER_MEMORY" \
  "$RECLUSTER_CPU"

# reembed — regenerate all embeddings
deploy_job "reembed" \
  "${REGISTRY}/workers:${TAG}" \
  "3600" \
  "dist/reembed.js" \
  "$WORKER_SECRETS" \
  "" \
  "$REEMBED_MEMORY" \
  "$REEMBED_CPU"

# resummarize — re-run LLM analysis on recent articles
deploy_job "resummarize" \
  "${REGISTRY}/workers:${TAG}" \
  "3600" \
  "dist/resummarize.js" \
  "$WORKER_SECRETS" \
  "SINCE_HOURS=24" \
  "$RESUMMARIZE_MEMORY" \
  "$RESUMMARIZE_CPU"

# repair — bounded repair for missing article/story summaries and embeddings
deploy_job "repair" \
  "${REGISTRY}/workers:${TAG}" \
  "600" \
  "dist/repair.js" \
  "$WORKER_SECRETS" \
  "REPAIR_LOOKBACK_HOURS=${REPAIR_LOOKBACK_HOURS},REPAIR_MAX_ARTICLES=${REPAIR_MAX_ARTICLES},REPAIR_MAX_STORIES=${REPAIR_MAX_STORIES},REPAIR_ANALYSIS_CONCURRENCY=${REPAIR_ANALYSIS_CONCURRENCY},REPAIR_EMBEDDING_BATCH_SIZE=${REPAIR_EMBEDDING_BATCH_SIZE},REPAIR_GRACE_MINUTES=${REPAIR_GRACE_MINUTES},TRIGGER_MODE=scheduled" \
  "$REPAIR_MEMORY" \
  "$REPAIR_CPU"

# ─────────────────────────────────────────────────────────────────
# Step 4: Run database migration
# ─────────────────────────────────────────────────────────────────

echo ""
echo "Running database migration..."
gcloud run jobs execute migrate --region="$REGION" --wait

# Clean up old monolithic job
if gcloud run jobs describe "scrape-pipeline" --region="$REGION" &>/dev/null; then
  echo "Deleting old scrape-pipeline job..."
  gcloud run jobs delete "scrape-pipeline" --region="$REGION" --quiet
fi

# ─────────────────────────────────────────────────────────────────
# Step 5: Set up Cloud Scheduler triggers
# ─────────────────────────────────────────────────────────────────

echo ""
echo "Setting up Cloud Scheduler..."

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
JOBS_API="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs"

create_or_update_schedule() {
  local name="$1" schedule="$2" job="$3"

  if gcloud scheduler jobs describe "$name" --location="$REGION" &>/dev/null; then
    gcloud scheduler jobs update http "$name" \
      --location="$REGION" \
      --schedule="$schedule" \
      --time-zone="$SCHEDULER_TIME_ZONE" \
      --uri="${JOBS_API}/${job}:run"
  else
    gcloud scheduler jobs create http "$name" \
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
    echo "  deleting obsolete scheduler ${name}"
    gcloud scheduler jobs delete "$name" --location="$REGION" --quiet
  fi
}

delete_schedule_if_exists "repair-trigger"
create_or_update_schedule "scrape-trigger" "$SCRAPE_DAY_SCHEDULE" "scrape"
create_or_update_schedule "scrape-night-trigger" "$SCRAPE_NIGHT_SCHEDULE" "scrape"
create_or_update_schedule "recluster-trigger" "$RECLUSTER_SCHEDULE" "recluster"

# ─────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Cloud Run services:"
echo "  API:             ${API_URL}"
echo "  Batch Clusterer: ${CLUSTERER_URL} (internal)"
echo ""
echo "Pipeline jobs (chained via Cloud Run Jobs API):"
echo "  scrape → process → embed-cluster"
echo ""
echo "Scheduled triggers:"
echo "  time zone:              ${SCHEDULER_TIME_ZONE}"
echo "  scrape-trigger:         ${SCRAPE_DAY_SCHEDULE} (Cloud Scheduler)"
echo "  scrape-night-trigger:   ${SCRAPE_NIGHT_SCHEDULE} (Cloud Scheduler)"
echo "  recluster-trigger:      ${RECLUSTER_SCHEDULE} (Cloud Scheduler)"
echo "  repair:                 every 3 hours (GitHub Actions)"
echo "  prune:             daily at 03:00 UTC (GitHub Actions)"
echo ""
echo "Manual jobs available:"
echo "  ./deploy/trigger-job.sh scrape"
echo "  ./deploy/trigger-job.sh process"
echo "  ./deploy/trigger-job.sh embed-cluster"
echo "  ./deploy/trigger-job.sh recluster"
echo "  ./deploy/trigger-job.sh reembed"
echo "  ./deploy/trigger-job.sh resummarize SINCE_HOURS=48"
echo "  ./deploy/trigger-job.sh repair"
echo ""
echo "=== NEXT: Configure Vercel ==="
echo ""
echo "1. Connect repo to Vercel (vercel.com/new)"
echo "   - Root directory: apps/web"
echo "   - Framework: Next.js"
echo ""
echo "2. Add environment variables in Vercel dashboard:"
echo "   API_URL=${API_URL}"
echo "   NEXT_PUBLIC_API_URL=${API_URL}"
echo ""
echo "3. After Vercel deploys, update CORS on the API:"
echo "   VERCEL_URL=https://your-app.vercel.app"
echo "   gcloud run services update api --region=${REGION} \\"
echo "     --set-env-vars=\"HOST=0.0.0.0,PORT=3001,CORS_ORIGIN=\${VERCEL_URL}\""
