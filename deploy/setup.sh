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

echo "=== Setting up GCP project: ${PROJECT_ID} ==="

# Create project (or skip if exists)
gcloud projects create "$PROJECT_ID" --name="Korkep" 2>/dev/null || true
gcloud config set project "$PROJECT_ID"

# Link billing account (required for Cloud Run)
# Find your billing account: gcloud billing accounts list
# gcloud billing projects link "$PROJECT_ID" --billing-account=XXXXXX-XXXXXX-XXXXXX

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com

# Create Artifact Registry repository for Docker images
gcloud artifacts repositories create korkep \
  --repository-format=docker \
  --location="$REGION" \
  --description="Korkep container images" \
  2>/dev/null || echo "Registry already exists"

# Configure Docker to authenticate with Artifact Registry
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── Store secrets ──────────────────────────────────────────────
# These commands read values from deploy/env.production.

if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  printf '%s' "$OPENROUTER_API_KEY" | \
    gcloud secrets create openrouter-api-key --data-file=- 2>/dev/null || \
    printf '%s' "$OPENROUTER_API_KEY" | \
    gcloud secrets versions add openrouter-api-key --data-file=-
  echo "Stored: openrouter-api-key"
fi

if [ -n "${DATABASE_URL:-}" ]; then
  printf '%s' "$DATABASE_URL" | \
    gcloud secrets create database-url --data-file=- 2>/dev/null || \
    printf '%s' "$DATABASE_URL" | \
    gcloud secrets versions add database-url --data-file=-
  echo "Stored: database-url"
fi

if [ -n "${REDIS_URL:-}" ]; then
  printf '%s' "$REDIS_URL" | \
    gcloud secrets create upstash-redis-url --data-file=- 2>/dev/null || \
    printf '%s' "$REDIS_URL" | \
    gcloud secrets versions add upstash-redis-url --data-file=-
  echo "Stored: upstash-redis-url"
fi

if [ -n "${GOOGLE_AI_STUDIO_API_KEY:-}" ]; then
  printf '%s' "$GOOGLE_AI_STUDIO_API_KEY" | \
    gcloud secrets create google-ai-studio-key --data-file=- 2>/dev/null || \
    printf '%s' "$GOOGLE_AI_STUDIO_API_KEY" | \
    gcloud secrets versions add google-ai-studio-key --data-file=-
  echo "Stored: google-ai-studio-key"
fi

# Grant Cloud Run service account access to secrets
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for secret in openrouter-api-key database-url upstash-redis-url google-ai-studio-key; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor" \
    2>/dev/null || true
done

# Grant Cloud Run invoker role (for Cloud Scheduler → Cloud Run Jobs)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA}" \
  --role="roles/run.invoker" \
  2>/dev/null || true

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Set up Neon PostgreSQL:"
echo "     - Go to https://neon.tech → Create free project"
echo "     - Region: aws-us-east-1 or aws-us-central-1"
echo "     - pgvector is pre-installed"
echo "     - Copy the POOLED connection string"
echo "  2. Set up Upstash Redis:"
echo "     - Go to https://upstash.com → Create Redis database"
echo "     - Copy the Redis connection string (REDIS_URL)"
echo "  3. Store secrets:"
echo "     cp deploy/env.production.example deploy/env.production"
echo "     # edit deploy/env.production"
echo "     ./deploy/setup.sh"
echo "  4. Set up Vercel:"
echo "     - Connect your repo at https://vercel.com"
echo "     - Root directory: apps/web"
echo "     - Framework preset: Next.js"
echo "     - Add env vars after deploy.sh gives you the API URL"
echo "  5. Run deploy.sh"
