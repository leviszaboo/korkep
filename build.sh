#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Rebuild containers, apply migrations, and start services.

Options:
  --reembed       Run reembed after startup
  --recluster     Run recluster after startup
  --resummarize   Run resummarize after startup (SINCE_HOURS env respected)
  --all           Run reembed + recluster + resummarize
  --no-cache      Build without Docker cache
  -h, --help      Show this help

Examples:
  ./build.sh                      # rebuild, migrate, start
  ./build.sh --recluster          # rebuild, migrate, start, then recluster
  ./build.sh --all                # rebuild, migrate, start, then all three
  SINCE_HOURS=48 ./build.sh --resummarize
EOF
  exit 0
}

RUN_REEMBED=false
RUN_RECLUSTER=false
RUN_RESUMMARIZE=false
BUILD_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reembed)      RUN_REEMBED=true ;;
    --recluster)    RUN_RECLUSTER=true ;;
    --resummarize)  RUN_RESUMMARIZE=true ;;
    --all)          RUN_REEMBED=true; RUN_RECLUSTER=true; RUN_RESUMMARIZE=true ;;
    --no-cache)     BUILD_ARGS+=(--no-cache) ;;
    -h|--help)      usage ;;
    *)              echo "Unknown option: $1"; usage ;;
  esac
  shift
done

cd "$(dirname "$0")"

echo "==> Building containers..."
docker compose build "${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}"

echo "==> Starting infrastructure (postgres, redis, clusterer)..."
docker compose up -d postgres redis clusterer

echo "==> Waiting for postgres..."
docker compose exec postgres sh -c 'until pg_isready -U korkep; do sleep 1; done'

echo "==> Running migrations..."
docker compose --profile setup run --rm migrate

echo "==> Starting all services..."
docker compose up -d

echo "==> Waiting for services to be healthy..."
docker compose exec api sh -c 'for i in $(seq 1 30); do node -e "fetch(\"http://localhost:3001/health\").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" 2>/dev/null && exit 0; sleep 2; done; exit 1'
echo "    API healthy."

if $RUN_REEMBED; then
  echo "==> Running reembed..."
  docker compose --profile reembed run --rm reembed
  echo "    Reembed complete."
fi

if $RUN_RECLUSTER; then
  echo "==> Running recluster..."
  docker compose --profile recluster run --rm recluster
  echo "    Recluster complete."
fi

if $RUN_RESUMMARIZE; then
  echo "==> Running resummarize..."
  docker compose --profile resummarize run --rm resummarize
  echo "    Resummarize complete."
fi

echo ""
echo "==> Done. Services running:"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
