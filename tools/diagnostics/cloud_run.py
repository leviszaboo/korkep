import json
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone

from storage import utc_now


def _run_json(args):
    result = subprocess.run(args, check=True, text=True, capture_output=True)
    if not result.stdout.strip():
        return []
    return json.loads(result.stdout)


def _resource_name(item):
    metadata = item.get("metadata") or {}
    return metadata.get("name") or item.get("name")


def _container_resources(item):
    spec = item.get("spec") or {}
    template = spec.get("template") or {}
    pod_spec = template.get("spec") or {}
    if not (pod_spec.get("containers") or []):
        pod_spec = ((template.get("spec") or {}).get("template") or {}).get("spec") or pod_spec
    containers = pod_spec.get("containers") or []
    resources = ((containers[0] if containers else {}).get("resources") or {}).get("limits") or {}
    cpu = _parse_cpu(resources.get("cpu"))
    memory_gib = _parse_memory_gib(resources.get("memory"))
    timeout = _parse_seconds(pod_spec.get("timeoutSeconds") or template.get("timeoutSeconds") or 0)
    return cpu, memory_gib, timeout


def _parse_cpu(raw):
    if raw is None:
        return 0.0
    text = str(raw)
    if text.endswith("m"):
        return float(text[:-1]) / 1000
    return float(text)


def _parse_memory_gib(raw):
    if raw is None:
        return 0.0
    text = str(raw).strip().lower()
    units = {"ki": 1 / 1024 / 1024, "mi": 1 / 1024, "gi": 1, "k": 1 / 1024 / 1024, "m": 1 / 1024, "g": 1}
    for suffix, multiplier in units.items():
        if text.endswith(suffix):
            return float(text[: -len(suffix)]) * multiplier
    return float(text) / 1024 / 1024 / 1024


def _parse_seconds(raw):
    if raw is None or raw == "":
        return 0.0
    return float(str(raw).rstrip("s"))


def _hour():
    return datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")


def _upsert(conn, row):
    conn.execute(
        """
        INSERT INTO cloud_run_hourly
          (hour, resource_type, resource_name, requests, runtime_seconds, cpu, memory_gib, vcpu_seconds, gib_seconds, executions, near_timeout_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(hour, resource_type, resource_name) DO UPDATE SET
          requests = excluded.requests,
          runtime_seconds = excluded.runtime_seconds,
          cpu = excluded.cpu,
          memory_gib = excluded.memory_gib,
          vcpu_seconds = excluded.vcpu_seconds,
          gib_seconds = excluded.gib_seconds,
          executions = excluded.executions,
          near_timeout_count = excluded.near_timeout_count
        """,
        row,
    )


ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
FIELD_RE = re.compile(r"^\s*([A-Za-z0-9_]+):\s*(.*)$")
PRETTY_MESSAGE_RE = re.compile(r"^\[[0-9:]+\]\s+\w+:\s+(.+)$")


def _parse_ts(raw):
    if not raw:
        return None
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def _iso(dt):
    return dt.isoformat(timespec="microseconds").replace("+00:00", "Z")


def _clean_log_text(raw):
    return ANSI_RE.sub("", raw or "").strip()


def _parse_pretty_value(raw):
    text = raw.strip().rstrip(",")
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return text[1:-1]
    if text == "true":
        return True
    if text == "false":
        return False
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        return text


def _runtime_ms_from_json_log(payload):
    if not isinstance(payload, dict):
        return None
    msg = str(payload.get("msg") or payload.get("message") or "")
    if "finished" not in msg.lower() and "complete" not in msg.lower():
        return None
    duration_ms = payload.get("durationMs")
    if isinstance(duration_ms, (int, float)):
        return float(duration_ms)
    return None


def _runtime_by_execution_from_logs(project, region, cutoff):
    log_limit = os.environ.get("CLOUD_RUN_LOG_LIMIT", os.environ.get("LOG_LIMIT", "20000"))
    cutoff_iso = _iso(cutoff)
    rows = _run_json(
        [
            "gcloud",
            "logging",
            "read",
            (
                'resource.type="cloud_run_job" '
                f'AND resource.labels.location="{region}" '
                f'AND timestamp>="{cutoff_iso}" '
                'AND logName="projects/'
                f"{project}"
                '/logs/run.googleapis.com%2Fstdout"'
                ' AND (textPayload:"durationMs" OR textPayload:"finished" OR textPayload:"complete" OR jsonPayload.durationMs:*)'
            ),
            "--project",
            project,
            "--limit",
            log_limit,
            "--order=asc",
            "--format=json",
        ]
    )

    runtimes = {}
    current_event_by_execution = {}
    for row in sorted(rows, key=lambda item: item.get("timestamp", "")):
        labels = row.get("labels") or {}
        execution_name = labels.get("run.googleapis.com/execution_name")
        if not execution_name:
            continue

        json_payload = row.get("jsonPayload")
        runtime_ms = _runtime_ms_from_json_log(json_payload)
        if runtime_ms is not None:
            runtimes[execution_name] = runtime_ms / 1000
            continue

        text = _clean_log_text(row.get("textPayload"))
        if not text:
            continue

        message_match = PRETTY_MESSAGE_RE.match(text)
        if message_match:
            current_event_by_execution[execution_name] = {
                "message": message_match.group(1),
                "fields": {},
            }
            continue

        field_match = FIELD_RE.match(text)
        if not field_match:
            continue

        event = current_event_by_execution.get(execution_name)
        if not event:
            continue

        key = field_match.group(1)
        value = _parse_pretty_value(field_match.group(2))
        event["fields"][key] = value

        message = str(event.get("message") or "").lower()
        if key == "durationMs" and isinstance(value, (int, float)) and ("finished" in message or "complete" in message):
            runtimes[execution_name] = float(value) / 1000

    return runtimes


def _upsert_execution(conn, row):
    conn.execute(
        """
        INSERT INTO cloud_run_job_executions
          (
            execution_name, job_name, region, started_at, completed_at, status,
            cpu, memory_gib, billed_seconds, app_runtime_seconds, overhead_seconds,
            billed_vcpu_seconds, billed_gib_seconds, app_vcpu_seconds, app_gib_seconds,
            overhead_vcpu_seconds, overhead_gib_seconds, collected_at
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(execution_name) DO UPDATE SET
          job_name = excluded.job_name,
          region = excluded.region,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          status = excluded.status,
          cpu = excluded.cpu,
          memory_gib = excluded.memory_gib,
          billed_seconds = excluded.billed_seconds,
          app_runtime_seconds = excluded.app_runtime_seconds,
          overhead_seconds = excluded.overhead_seconds,
          billed_vcpu_seconds = excluded.billed_vcpu_seconds,
          billed_gib_seconds = excluded.billed_gib_seconds,
          app_vcpu_seconds = excluded.app_vcpu_seconds,
          app_gib_seconds = excluded.app_gib_seconds,
          overhead_vcpu_seconds = excluded.overhead_vcpu_seconds,
          overhead_gib_seconds = excluded.overhead_gib_seconds,
          collected_at = excluded.collected_at
        """,
        row,
    )


def collect(conn):
    project = os.environ["GCP_PROJECT_ID"]
    region = os.environ["GCP_REGION"]
    hour = _hour()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=int(os.environ.get("DIAGNOSTICS_LOOKBACK_HOURS", "24")))
    runtime_by_execution = _runtime_by_execution_from_logs(project, region, cutoff)
    collected_at = utc_now()

    services = _run_json(["gcloud", "run", "services", "list", "--project", project, "--region", region, "--format=json"])
    for service in services:
        name = _resource_name(service)
        cpu, memory_gib, _timeout = _container_resources(service)
        _upsert(conn, (hour, "service", name, 0, 0, cpu, memory_gib, 0, 0, 0, 0))

    jobs = _run_json(["gcloud", "run", "jobs", "list", "--project", project, "--region", region, "--format=json"])
    for job in jobs:
        name = _resource_name(job)
        desc = _run_json(["gcloud", "run", "jobs", "describe", name, "--project", project, "--region", region, "--format=json"])
        cpu, memory_gib, timeout = _container_resources(desc)
        executions = _run_json(
            ["gcloud", "run", "jobs", "executions", "list", "--job", name, "--project", project, "--region", region, "--format=json"]
        )

        count = 0
        runtime_seconds = 0.0
        near_timeout = 0
        for execution in executions:
            execution_name = _resource_name(execution)
            status = execution.get("status") or {}
            started_at = _parse_ts(status.get("startTime"))
            completed_at = _parse_ts(status.get("completionTime"))
            if not started_at or not completed_at:
                continue
            if completed_at < cutoff:
                continue
            seconds = max(0.0, (completed_at - started_at).total_seconds())
            count += 1
            runtime_seconds += seconds
            if timeout and seconds >= timeout * 0.9:
                near_timeout += 1

            app_runtime_seconds = runtime_by_execution.get(execution_name)
            overhead_seconds = None
            app_vcpu_seconds = None
            app_gib_seconds = None
            overhead_vcpu_seconds = None
            overhead_gib_seconds = None
            if app_runtime_seconds is not None:
                app_runtime_seconds = min(app_runtime_seconds, seconds)
                overhead_seconds = max(0.0, seconds - app_runtime_seconds)
                app_vcpu_seconds = app_runtime_seconds * cpu
                app_gib_seconds = app_runtime_seconds * memory_gib
                overhead_vcpu_seconds = overhead_seconds * cpu
                overhead_gib_seconds = overhead_seconds * memory_gib

            condition_status = "unknown"
            conditions = status.get("conditions") or []
            completed_condition = next((item for item in conditions if item.get("type") == "Completed"), None)
            if completed_condition:
                condition_status = completed_condition.get("status") or condition_status

            _upsert_execution(
                conn,
                (
                    execution_name,
                    name,
                    region,
                    _iso(started_at),
                    _iso(completed_at),
                    condition_status,
                    cpu,
                    memory_gib,
                    seconds,
                    app_runtime_seconds,
                    overhead_seconds,
                    seconds * cpu,
                    seconds * memory_gib,
                    app_vcpu_seconds,
                    app_gib_seconds,
                    overhead_vcpu_seconds,
                    overhead_gib_seconds,
                    collected_at,
                ),
            )

        _upsert(
            conn,
            (
                hour,
                "job",
                name,
                0,
                runtime_seconds,
                cpu,
                memory_gib,
                runtime_seconds * cpu,
                runtime_seconds * memory_gib,
                count,
                near_timeout,
            ),
        )
