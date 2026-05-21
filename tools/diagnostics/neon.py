import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from storage import utc_now


API_BASE = "https://console.neon.tech/api/v2"


def _get_json(path, params=None):
    api_key = os.environ["NEON_API_KEY"]
    url = API_BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _counter_value(payload):
    container = payload.get("project") or payload.get("branch") or payload
    return int(container.get("data_transfer_bytes") or 0)


def _previous_counter(conn, project_id, branch_id, source):
    row = conn.execute(
        """
        SELECT data_transfer_bytes
        FROM neon_transfer_counters
        WHERE project_id = ? AND COALESCE(branch_id, '') = COALESCE(?, '') AND source = ?
        ORDER BY collected_at DESC
        LIMIT 1
        """,
        (project_id, branch_id, source),
    ).fetchone()
    return None if row is None else int(row[0])


def _store_counter(conn, project_id, branch_id, value, source):
    collected_at = utc_now()
    previous = _previous_counter(conn, project_id, branch_id, source)
    reset = previous is not None and value < previous
    conn.execute(
        """
        INSERT INTO neon_transfer_counters
          (collected_at, project_id, branch_id, data_transfer_bytes, source, counter_reset)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(collected_at, project_id, branch_id, source) DO UPDATE SET
          data_transfer_bytes = excluded.data_transfer_bytes,
          counter_reset = excluded.counter_reset
        """,
        (collected_at, project_id, branch_id, value, source, 1 if reset else 0),
    )

    if previous is not None and not reset:
        hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")
        delta = max(0, value - previous)
        conn.execute(
            """
            INSERT INTO neon_egress_hourly
              (hour, project_id, branch_id, public_bytes, private_bytes, total_bytes, source_granularity, collected_at)
            VALUES (?, ?, ?, ?, 0, ?, ?, ?)
            ON CONFLICT(hour, project_id, branch_id, source_granularity) DO UPDATE SET
              public_bytes = excluded.public_bytes,
              private_bytes = excluded.private_bytes,
              total_bytes = excluded.total_bytes,
              collected_at = excluded.collected_at
            """,
            (hour, project_id, branch_id, delta, delta, "counter_delta", collected_at),
        )


def _collect_consumption(conn):
    org_id = os.environ.get("NEON_ORG_ID")
    if not org_id:
        return

    lookback = min(int(os.environ.get("DIAGNOSTICS_LOOKBACK_HOURS", "24")), 168)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    start = now - timedelta(hours=lookback)
    project_ids = [p.strip() for p in os.environ.get("NEON_PROJECT_IDS", "").split(",") if p.strip()]
    params = {
        "org_id": org_id,
        "from": start.isoformat().replace("+00:00", "Z"),
        "to": now.isoformat().replace("+00:00", "Z"),
        "granularity": "hourly",
        "metrics": "public_network_transfer_bytes,private_network_transfer_bytes",
    }
    if project_ids:
        params["project_ids"] = ",".join(project_ids)

    payload = _get_json("/consumption_history/v2/projects", params)
    collected_at = utc_now()
    rows = payload.get("projects") or payload.get("data") or []
    for project in rows:
        project_id = project.get("project_id") or project.get("id")
        buckets = project.get("usage") or project.get("buckets") or []
        for bucket in buckets:
            metrics = bucket.get("metrics") or bucket
            public_bytes = int(metrics.get("public_network_transfer_bytes") or 0)
            private_bytes = int(metrics.get("private_network_transfer_bytes") or 0)
            total = public_bytes + private_bytes
            hour = bucket.get("hour") or bucket.get("time") or bucket.get("timestamp")
            if project_id and hour:
                conn.execute(
                    """
                    INSERT INTO neon_egress_hourly
                      (hour, project_id, branch_id, public_bytes, private_bytes, total_bytes, source_granularity, collected_at)
                    VALUES (?, ?, NULL, ?, ?, ?, 'neon_hourly', ?)
                    ON CONFLICT(hour, project_id, branch_id, source_granularity) DO UPDATE SET
                      public_bytes = excluded.public_bytes,
                      private_bytes = excluded.private_bytes,
                      total_bytes = excluded.total_bytes,
                      collected_at = excluded.collected_at
                    """,
                    (hour, project_id, public_bytes, private_bytes, total, collected_at),
                )


def collect(conn):
    project_id = os.environ["NEON_PROJECT_ID"]
    project_payload = _get_json(f"/projects/{project_id}")
    _store_counter(conn, project_id, None, _counter_value(project_payload), "project")

    for branch_id in [b.strip() for b in os.environ.get("NEON_BRANCH_IDS", "").split(",") if b.strip()]:
        branch_payload = _get_json(f"/projects/{project_id}/branches/{branch_id}")
        _store_counter(conn, project_id, branch_id, _counter_value(branch_payload), "branch")

    _collect_consumption(conn)
