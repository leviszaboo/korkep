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

echo "=== Tearing Down Korkep Infrastructure ==="
echo ""
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

read -p "Are you sure you want to delete all Cloud Run services, jobs, and schedulers? (yes/no): " -r
echo
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
  echo "Teardown cancelled."
  exit 0
fi

# ─────────────────────────────────────────────────────────────────
# Step 1: Stop Cloud Scheduler triggers
# ─────────────────────────────────────────────────────────────────

echo ""
echo "Stopping Cloud Scheduler triggers..."

for scheduler in scrape-trigger scrape-night-trigger recluster-trigger repair-trigger; do
  if gcloud scheduler jobs describe "$scheduler" --location="$REGION" &>/dev/null; then
    echo "  Pausing $scheduler..."
    gcloud scheduler jobs pause "$scheduler" --location="$REGION"
  else
    echo "  $scheduler not found (skipping)"
  fi
done

# ─────────────────────────────────────────────────────────────────
# Step 2: Delete Cloud Run Jobs
# ─────────────────────────────────────────────────────────────────

echo ""
echo "Deleting Cloud Run Jobs..."

for job in migrate scrape process embed-cluster recluster reembed resummarize repair; do
  if gcloud run jobs describe "$job" --region="$REGION" &>/dev/null; then
    echo "  Deleting $job..."
    gcloud run jobs delete "$job" --region="$REGION" --quiet
  else
    echo "  $job not found (skipping)"
  fi
done

# ─────────────────────────────────────────────────────────────────
# Step 3: Delete Cloud Run Services
# ─────────────────────────────────────────────────────────────────

echo ""
echo "Deleting Cloud Run Services..."

for service in api batch-clusterer; do
  if gcloud run services describe "$service" --region="$REGION" &>/dev/null; then
    echo "  Deleting $service..."
    gcloud run services delete "$service" --region="$REGION" --quiet
  else
    echo "  $service not found (skipping)"
  fi
done

# ─────────────────────────────────────────────────────────────────
# Step 4: Delete Cloud Scheduler Jobs
# ─────────────────────────────────────────────────────────────────

echo ""
echo "Deleting Cloud Scheduler Jobs..."

for scheduler in scrape-trigger scrape-night-trigger recluster-trigger repair-trigger; do
  if gcloud scheduler jobs describe "$scheduler" --location="$REGION" &>/dev/null; then
    echo "  Deleting $scheduler..."
    gcloud scheduler jobs delete "$scheduler" --location="$REGION" --quiet
  else
    echo "  $scheduler not found (skipping)"
  fi
done

# ─────────────────────────────────────────────────────────────────
# Step 5: Delete Secrets (optional)
# ─────────────────────────────────────────────────────────────────

echo ""
read -p "Delete secrets from Secret Manager? (yes/no): " -r
echo
if [[ $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
  echo "Deleting secrets..."

  for secret in openrouter-api-key database-url upstash-redis-url google-ai-studio-key; do
    if gcloud secrets describe "$secret" &>/dev/null; then
      echo "  Deleting $secret..."
      gcloud secrets delete "$secret" --quiet || true
    fi
  done
fi

# ─────────────────────────────────────────────────────────────────
# Step 6: Delete Container Images (optional)
# ─────────────────────────────────────────────────────────────────

echo ""
read -p "Delete container images from registry? (yes/no): " -r
echo
if [[ $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
  echo "Deleting container images..."
  
  for image in api workers batch-clusterer; do
    echo "  Deleting ${REGISTRY}/${image}:*"
    # List and delete all images for this service
    gcloud container images list-tags "${REGISTRY}/${image}" --format="get(digest)" | while read -r digest; do
      gcloud container images delete "${REGISTRY}/${image}@${digest}" --quiet || true
    done || true
  done
  
  # Delete empty repository if it exists
  if gcloud artifacts repositories describe korkep --location="$REGION" &>/dev/null; then
    echo "  Deleting Artifact Registry repository..."
    gcloud artifacts repositories delete korkep --location="$REGION" --quiet || echo "  (repository still has resources, skipping)"
  fi
fi

# ─────────────────────────────────────────────────────────────────
# Step 7: List Remaining Resources
# ─────────────────────────────────────────────────────────────────

echo ""
echo "=== Remaining Cloud Run Resources ==="
echo ""
echo "Services:"
gcloud run services list --region="$REGION" || echo "  (none)"

echo ""
echo "Jobs:"
gcloud run jobs list --region="$REGION" || echo "  (none)"

echo ""
echo "Schedulers:"
gcloud scheduler jobs list --location="$REGION" || echo "  (none)"

# ─────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────

echo ""
echo "=== Teardown complete ==="
echo ""
echo "Summary:"
echo "  ✓ Cloud Scheduler jobs stopped/deleted"
echo "  ✓ Cloud Run jobs deleted"
echo "  ✓ Cloud Run services deleted"
echo "  ✓ Secrets deleted (if selected)"
echo ""
echo "To redeploy, run:"
echo "  ./deploy/setup.sh"
echo "  ./deploy/deploy.sh"
echo ""
