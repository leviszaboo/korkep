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

REGION="${GCP_REGION:?GCP_REGION is required in ${ENV_FILE}}"

usage() {
  echo "Usage: $0 <job-name> [KEY=VALUE ...]"
  echo ""
  echo "Pipeline jobs:"
  echo "  scrape               Fetch RSS, dedup, insert raw articles"
  echo "  process              LLM article labeling (triggered by scrape)"
  echo "  embed-cluster        Embed + assign story (triggered by process)"
  echo ""
  echo "Periodic jobs:"
  echo "  recluster            Re-run HDBSCAN clustering on last 72h"
  echo ""
  echo "Manual utility jobs:"
  echo "  reembed              Regenerate all article embeddings"
  echo "  resummarize          Re-run LLM analysis on recent articles"
  echo "  repair               Fix missing article/story summaries and embeddings"
  echo "  migrate              Run database migrations"
  echo ""
  echo "Options (passed as env var overrides):"
  echo "  SINCE_HOURS=48         Time window for resummarize"
  echo "  RECLUSTER_NO_CACHE=1   Skip cache during recluster"
  echo "  REPAIR_LOOKBACK_HOURS=48  Time window for repair"
  echo "  REPAIR_GRACE_MINUTES=90   Skip newer article/story records"
  echo "  REPAIR_MAX_ARTICLES=25    Max article repairs in one run"
  echo "  REPAIR_MAX_STORIES=10     Max story summary repairs in one run"
  echo ""
  echo "Examples:"
  echo "  $0 scrape"
  echo "  $0 recluster"
  echo "  $0 resummarize SINCE_HOURS=48"
  echo "  $0 repair"
  echo "  $0 repair REPAIR_MAX_ARTICLES=25 REPAIR_MAX_STORIES=10 REPAIR_LOOKBACK_HOURS=48 REPAIR_GRACE_MINUTES=90"
  echo "  $0 reembed"
  echo ""
  echo "Note: prune runs via GitHub Actions, not Cloud Run Jobs."
  echo "  Trigger manually: gh workflow run prune.yml -f retention_days=7"
  exit 1
}

[ $# -lt 1 ] && usage

JOB="$1"
shift

case "$JOB" in
  scrape|process|embed-cluster|recluster|reembed|resummarize|repair|migrate) ;;
  *) echo "Unknown job: ${JOB}"; usage ;;
esac

EXTRA_VARS="TRIGGER_MODE=manual"
if [ $# -gt 0 ]; then
  EXTRA_VARS="${EXTRA_VARS},$(IFS=,; echo "$*")"
fi
ENV_ARGS="--update-env-vars=${EXTRA_VARS}"

echo "Executing Cloud Run Job: ${JOB}"
echo "Region: ${REGION}"
echo "Env overrides: ${EXTRA_VARS}"
echo ""

gcloud run jobs execute "$JOB" \
  --region="$REGION" \
  $ENV_ARGS \
  --wait

echo ""
echo "Job completed. View full logs:"
echo "  gcloud logging read 'resource.type=cloud_run_job AND resource.labels.job_name=${JOB}' \\"
echo "    --limit=100 --format='value(textPayload)'"
