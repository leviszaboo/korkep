#!/usr/bin/env python3
import argparse
import os
import signal
import sys
import time


STOP_REQUESTED = False


def _handle_stop(signum, frame):
    global STOP_REQUESTED
    STOP_REQUESTED = True


def env_int(name, default):
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return int(raw)


def collect_once():
    from redaction import redact
    from storage import connect, finish_run, migrate, record_source_error, start_run

    db_path = os.environ.get("DIAGNOSTICS_DB_PATH", ".diagnostics/diagnostics.sqlite")
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)

    source_errors = []
    successes = 0
    status = "success"
    with connect(db_path) as conn:
        migrate(conn)
        run_id = start_run(conn)
        collectors = []

        if os.environ.get("NEON_API_KEY") and os.environ.get("NEON_PROJECT_ID"):
            from neon import collect as collect_neon

            collectors.append(("neon", collect_neon))

        if os.environ.get("DATABASE_URL"):
            from llm_usage import collect as collect_llm_usage
            from postgres import collect as collect_postgres

            if os.environ.get("DIAGNOSTICS_STORAGE", "sqlite").strip().lower() != "postgres":
                collectors.append(("llm_usage", collect_llm_usage))
            collectors.append(("postgres", collect_postgres))

        if os.environ.get("GCP_PROJECT_ID") and os.environ.get("GCP_REGION"):
            from cloud_run import collect as collect_cloud_run

            collectors.append(("cloud_run", collect_cloud_run))

        for index, (source, collect) in enumerate(collectors):
            savepoint = f"diagnostics_source_{index}"
            conn.execute(f"SAVEPOINT {savepoint}")
            try:
                collect(conn)
                conn.execute(f"RELEASE SAVEPOINT {savepoint}")
                successes += 1
            except Exception as exc:
                conn.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                conn.execute(f"RELEASE SAVEPOINT {savepoint}")
                message = redact(f"{type(exc).__name__}: {exc}")
                source_errors.append({"source": source, "error": message})
                record_source_error(conn, source, message)
                print(f"diagnostics {source}: {message}", file=sys.stderr, flush=True)

        status = "success" if not source_errors else "partial_failure"
        if collectors and successes == 0:
            status = "failure"
        finish_run(conn, run_id, status, source_errors)

    storage = os.environ.get("DIAGNOSTICS_STORAGE", "sqlite")
    destination = "Postgres diagnostics schema" if storage == "postgres" else db_path
    print(f"diagnostics collect-once: {status}; wrote {destination}", flush=True)
    return 1 if status == "failure" else 0


def run_loop():
    poll_seconds = env_int("DIAGNOSTICS_POLL_SECONDS", 3600)
    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    while not STOP_REQUESTED:
        collect_once()
        deadline = time.monotonic() + poll_seconds
        while not STOP_REQUESTED and time.monotonic() < deadline:
            time.sleep(min(1, deadline - time.monotonic()))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Collect cost diagnostics into SQLite.")
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("collect-once")
    subcommands.add_parser("run")
    args = parser.parse_args(argv)

    if args.command == "collect-once":
        return collect_once()
    if args.command == "run":
        return run_loop()
    raise AssertionError(args.command)


if __name__ == "__main__":
    raise SystemExit(main())
