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

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

memory_to_gib() {
  local raw="$1"
  python3 - "$raw" <<'PY'
import re
import sys

raw = sys.argv[1] or "0"
match = re.fullmatch(r"([0-9.]+)\s*([A-Za-z]+)?", raw)
if not match:
    print("0")
    raise SystemExit

value = float(match.group(1))
unit = (match.group(2) or "Gi").lower()
if unit in ("g", "gi", "gib"):
    gib = value
elif unit in ("m", "mi", "mib"):
    gib = value / 1024
elif unit in ("k", "ki", "kib"):
    gib = value / 1024 / 1024
else:
    gib = value / 1024 / 1024 / 1024
print(f"{gib:.6f}")
PY
}

percent() {
  python3 - "$1" "$2" <<'PY'
import sys
used = float(sys.argv[1] or 0)
limit = float(sys.argv[2] or 0)
print("n/a" if limit <= 0 else f"{(used / limit * 100):.1f}%")
PY
}

month_projection() {
  python3 - "$1" "$LOOKBACK_DAYS" <<'PY'
import sys
value = float(sys.argv[1] or 0)
days = float(sys.argv[2] or 1)
print(f"{value * 30 / days:.2f}")
PY
}

timestamp_cutoff() {
  python3 - "$LOOKBACK_DAYS" <<'PY'
from datetime import datetime, timedelta, timezone
import sys
days = int(sys.argv[1])
print((datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds").replace("+00:00", "Z"))
PY
}

print_header() {
  echo ""
  echo "=== $1 ==="
  echo ""
}

run_cloud_run_inventory() {
  print_header "Cloud Run Resource Assignments"

  echo "Project: ${PROJECT_ID}"
  echo "Region:  ${REGION}"
  echo "Window:  last ${LOOKBACK_DAYS} day(s), projected to 30 days"
  echo ""

  gcloud config set project "$PROJECT_ID" >/dev/null

  local services_json jobs_json
  services_json="$(mktemp)"
  jobs_json="$(mktemp)"
  gcloud run services list --region="$REGION" --format=json >"$services_json"
  gcloud run jobs list --region="$REGION" --format=json >"$jobs_json"

  python3 - "$services_json" "$jobs_json" <<'PY'
import json
import sys

services = json.load(open(sys.argv[1]))
jobs = json.load(open(sys.argv[2]))

def limits(container):
    resources = container.get("resources") or {}
    lim = resources.get("limits") or {}
    return lim.get("cpu", "0"), lim.get("memory", "0")

print("Services:")
for svc in services:
    name = svc.get("metadata", {}).get("name", "?")
    spec = (((svc.get("spec") or {}).get("template") or {}).get("spec") or {})
    containers = spec.get("containers") or [{}]
    cpu, memory = limits(containers[0])
    min_instances = ((svc.get("metadata") or {}).get("annotations") or {}).get("run.googleapis.com/minScale", "0")
    max_instances = ((svc.get("metadata") or {}).get("annotations") or {}).get("run.googleapis.com/maxScale", "?")
    print(f"  {name:18} cpu={cpu:<4} memory={memory:<8} min={min_instances:<2} max={max_instances}")

print("\nJobs:")
for job in jobs:
    name = job.get("metadata", {}).get("name", "?")
    spec = (((((job.get("spec") or {}).get("template") or {}).get("spec") or {}).get("template") or {}).get("spec") or {})
    containers = spec.get("containers") or [{}]
    cpu, memory = limits(containers[0])
    timeout = spec.get("timeoutSeconds", "?")
    print(f"  {name:18} cpu={cpu:<4} memory={memory:<8} timeout={timeout}s")
PY
}

run_job_usage() {
  print_header "Cloud Run Jobs Usage"

  local jobs_file job_count
  jobs_file="$(mktemp)"
  gcloud run jobs list --region="$REGION" --format='value(metadata.name)' >"$jobs_file"
  job_count="$(wc -l <"$jobs_file" | tr -d ' ')"
  if [ "$job_count" -eq 0 ]; then
    echo "No Cloud Run jobs found."
    return
  fi

  printf "%-18s %8s %12s %12s %12s %12s\n" "job" "runs" "sec" "30d vCPU-s" "30d GiB-s" "timeout?"

  local total_vcpu=0
  local total_gib=0
  local cutoff
  cutoff="$(timestamp_cutoff)"

  while IFS= read -r job; do
    [ -z "$job" ] && continue
    local desc_json exec_json cpu memory memory_gib
    desc_json="$(mktemp)"
    exec_json="$(mktemp)"
    gcloud run jobs describe "$job" --region="$REGION" --format=json >"$desc_json"
    gcloud run jobs executions list --job="$job" --region="$REGION" --format=json >"$exec_json" 2>/dev/null || true

    cpu="$(python3 - "$desc_json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
spec=d.get("spec",{}).get("template",{}).get("spec",{}).get("template",{}).get("spec",{})
containers=spec.get("containers") or [{}]
print((containers[0].get("resources") or {}).get("limits",{}).get("cpu","0"))
PY
)"
    memory="$(python3 - "$desc_json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
spec=d.get("spec",{}).get("template",{}).get("spec",{}).get("template",{}).get("spec",{})
containers=spec.get("containers") or [{}]
print((containers[0].get("resources") or {}).get("limits",{}).get("memory","0"))
PY
)"
    memory_gib="$(memory_to_gib "$memory")"

    local timeout stats
    timeout="$(python3 - "$desc_json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
spec=d.get("spec",{}).get("template",{}).get("spec",{}).get("template",{}).get("spec",{})
print(spec.get("timeoutSeconds", 0) or 0)
PY
)"
    stats="$(python3 - "$exec_json" "$cutoff" "$timeout" <<'PY'
import json
import sys
from datetime import datetime, timezone

def parse_ts(raw):
    if not raw:
        return None
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))

executions = json.load(open(sys.argv[1]))
cutoff = parse_ts(sys.argv[2])
timeout = float(sys.argv[3] or 0)
runs = 0
seconds = 0.0
near_timeout = 0
for item in executions:
    status = item.get("status") or {}
    start = parse_ts(status.get("startTime") or item.get("metadata", {}).get("creationTimestamp"))
    end = parse_ts(status.get("completionTime"))
    if not start or start < cutoff:
        continue
    runs += 1
    if end:
        duration = max((end - start).total_seconds(), 0)
        seconds += duration
        if timeout > 0 and duration >= 0.9 * timeout:
            near_timeout += 1
print(f"{runs} {seconds:.2f} {near_timeout}")
PY
)"
    local runs seconds near_timeout projected_vcpu projected_gib
    read -r runs seconds near_timeout <<<"$stats"
    projected_vcpu="$(python3 - "$seconds" "$cpu" "$LOOKBACK_DAYS" <<'PY'
import sys
seconds=float(sys.argv[1]); cpu=float(sys.argv[2] or 0); days=float(sys.argv[3])
print(f"{seconds * cpu * 30 / days:.2f}")
PY
)"
    projected_gib="$(python3 - "$seconds" "$memory_gib" "$LOOKBACK_DAYS" <<'PY'
import sys
seconds=float(sys.argv[1]); gib=float(sys.argv[2] or 0); days=float(sys.argv[3])
print(f"{seconds * gib * 30 / days:.2f}")
PY
)"
    total_vcpu="$(python3 - "$total_vcpu" "$projected_vcpu" <<'PY'
import sys
print(float(sys.argv[1]) + float(sys.argv[2]))
PY
)"
    total_gib="$(python3 - "$total_gib" "$projected_gib" <<'PY'
import sys
print(float(sys.argv[1]) + float(sys.argv[2]))
PY
)"
    printf "%-18s %8s %12.2f %12.2f %12.2f %12s\n" "$job" "$runs" "$seconds" "$projected_vcpu" "$projected_gib" "$near_timeout"
  done <"$jobs_file"

  echo ""
  echo "Projected job compute:  ${total_vcpu} vCPU-s/month ($(percent "$total_vcpu" "$CLOUD_RUN_FREE_VCPU_SECONDS") of free tier)"
  echo "Projected job memory:   ${total_gib} GiB-s/month ($(percent "$total_gib" "$CLOUD_RUN_FREE_GIB_SECONDS") of free tier)"
}

run_service_request_usage() {
  print_header "Cloud Run Service Request Usage"

  local since logs_json services_json
  since="$(timestamp_cutoff)"
  logs_json="$(mktemp)"
  services_json="$(mktemp)"

  gcloud run services list --region="$REGION" --format=json >"$services_json"
  gcloud logging read \
    "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"${REGION}\" AND timestamp>=\"${since}\"" \
    --limit="$LOG_LIMIT" \
    --format=json >"$logs_json" || true

  python3 - "$logs_json" "$services_json" "$LOOKBACK_DAYS" "$CLOUD_RUN_FREE_REQUESTS" "$CLOUD_RUN_FREE_VCPU_SECONDS" "$CLOUD_RUN_FREE_GIB_SECONDS" <<'PY'
import json
import re
import sys

logs = json.load(open(sys.argv[1])) if open(sys.argv[1]).read().strip() else []
services = json.load(open(sys.argv[2]))
days = float(sys.argv[3])
free_requests = float(sys.argv[4])
free_vcpu = float(sys.argv[5])
free_gib = float(sys.argv[6])

def memory_to_gib(raw):
    m = re.fullmatch(r"([0-9.]+)\s*([A-Za-z]+)?", raw or "0")
    if not m:
        return 0.0
    value = float(m.group(1))
    unit = (m.group(2) or "Gi").lower()
    if unit in ("g", "gi", "gib"):
        return value
    if unit in ("m", "mi", "mib"):
        return value / 1024
    if unit in ("k", "ki", "kib"):
        return value / 1024 / 1024
    return value / 1024 / 1024 / 1024

def seconds(raw):
    if not raw:
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    return float(str(raw).rstrip("s") or 0)

limits = {}
for svc in services:
    name = svc.get("metadata", {}).get("name", "?")
    spec = svc.get("spec", {}).get("template", {}).get("spec", {})
    containers = spec.get("containers") or [{}]
    lim = (containers[0].get("resources") or {}).get("limits") or {}
    limits[name] = (float(lim.get("cpu") or 0), memory_to_gib(lim.get("memory") or "0"))

usage = {}
for row in logs:
    http = row.get("httpRequest") or {}
    if not http:
        continue
    labels = (row.get("resource") or {}).get("labels") or {}
    service = labels.get("service_name")
    if not service:
        continue
    data = usage.setdefault(service, {"requests": 0, "seconds": 0.0})
    data["requests"] += 1
    data["seconds"] += seconds(http.get("latency"))

print(f"{'service':18} {'requests':>10} {'30d req':>12} {'30d vCPU-s':>12} {'30d GiB-s':>12}")
total_req = total_vcpu = total_gib = 0.0
for service in sorted(limits):
    data = usage.get(service, {"requests": 0, "seconds": 0.0})
    cpu, mem = limits[service]
    projected_req = data["requests"] * 30 / days
    projected_vcpu = data["seconds"] * cpu * 30 / days
    projected_gib = data["seconds"] * mem * 30 / days
    total_req += projected_req
    total_vcpu += projected_vcpu
    total_gib += projected_gib
    print(f"{service:18} {data['requests']:10.0f} {projected_req:12.0f} {projected_vcpu:12.2f} {projected_gib:12.2f}")

def pct(value, limit):
    return "n/a" if limit <= 0 else f"{value / limit * 100:.1f}%"

print()
print(f"Projected service requests: {total_req:.0f}/month ({pct(total_req, free_requests)} of free tier)")
print(f"Projected service compute:  {total_vcpu:.2f} vCPU-s/month ({pct(total_vcpu, free_vcpu)} of free tier)")
print(f"Projected service memory:   {total_gib:.2f} GiB-s/month ({pct(total_gib, free_gib)} of free tier)")
if len(logs) >= 1:
    print(f"Log rows read: {len(logs)}. Increase LOG_LIMIT if this hit your cap.")
PY
}

run_postgres_diagnostics() {
  if [ -z "${DATABASE_URL:-}" ]; then
    print_header "Postgres Diagnostics"
    echo "Set DATABASE_URL to include Postgres and LLM usage diagnostics."
    return
  fi

  require_cmd psql
  print_header "Postgres Diagnostics"

  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<SQL
\\pset pager off
\\pset null '(null)'

SELECT
  pg_size_pretty(pg_database_size(current_database())) AS database_size,
  round(pg_database_size(current_database()) * 100.0 / ${NEON_FREE_STORAGE_BYTES}, 1) AS pct_of_configured_free_storage;

SELECT
  count(*) AS total_articles,
  count(*) FILTER (WHERE embedding IS NOT NULL) AS articles_with_embeddings,
  count(*) FILTER (WHERE story_id IS NULL) AS articles_without_story,
  count(*) FILTER (WHERE article_type = 'aggregation') AS aggregation_articles
FROM articles;

SELECT count(*) AS total_stories FROM stories;

SELECT article_count, count(*) AS story_count
FROM stories
GROUP BY article_count
ORDER BY article_count;

SELECT id, article_count, source_count, left(title, 90) AS title
FROM stories
ORDER BY article_count DESC
LIMIT 10;

SELECT
  mode,
  provider,
  operation,
  count(*) AS requests,
  coalesce(sum(prompt_tokens), 0) AS prompt_tokens,
  coalesce(sum(completion_tokens), 0) AS completion_tokens,
  coalesce(sum(total_tokens), 0) AS total_tokens
FROM llm_usage_log
WHERE called_at >= now() - interval '${LOOKBACK_DAYS} days'
GROUP BY mode, provider, operation
ORDER BY total_tokens DESC, requests DESC;

SELECT
  activity,
  mode,
  provider,
  count(*) AS requests,
  coalesce(sum(total_tokens), 0) AS total_tokens
FROM llm_usage_log
WHERE called_at >= now() - interval '${LOOKBACK_DAYS} days'
GROUP BY activity, mode, provider
ORDER BY total_tokens DESC, requests DESC;
SQL
}

run_recommendations() {
  print_header "Resource Assignment Notes"
  cat <<'TXT'
- If batch-clusterer request latency is low and memory stays below 512Mi in Cloud Run metrics, test 512Mi before changing CPU.
- Keeping batch-clusterer separate lets the Node jobs avoid Python/scikit image weight and lets HDBSCAN be tuned independently.
- Merging batch-clusterer into recluster only makes sense if Cloud Run service cold starts dominate the recluster runtime; otherwise it likely saves little and reduces resource isolation.
- For recluster, first tune schedule frequency and LLM mode/concurrency. The HDBSCAN and post-process path is not the likely cost driver if the logs show it is already fast.
- For process/repair/resummarize, mode/provider/token splits are usually more important than CPU/RAM because those jobs wait on external LLM calls.
TXT
}

main() {
  require_cmd gcloud
  require_cmd python3

  run_cloud_run_inventory
  run_service_request_usage
  run_job_usage
  run_postgres_diagnostics
  run_recommendations
}

main "$@"
