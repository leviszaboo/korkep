import os

import psycopg

from storage import utc_now


METRIC_QUERIES = [
    (
        "database_size",
        "database",
        "bytes",
        "SELECT current_database(), pg_database_size(current_database())::float8",
    ),
    (
        "table_size",
        "table",
        "bytes",
        """
        SELECT relname, pg_total_relation_size(oid)::float8
        FROM pg_class
        WHERE relkind = 'r'
        ORDER BY pg_total_relation_size(oid) DESC
        LIMIT 30
        """,
    ),
    (
        "index_size",
        "index",
        "bytes",
        """
        SELECT relname, pg_relation_size(oid)::float8
        FROM pg_class
        WHERE relkind = 'i'
        ORDER BY pg_relation_size(oid) DESC
        LIMIT 30
        """,
    ),
    (
        "estimated_rows",
        "table",
        "rows",
        """
        SELECT relname, GREATEST(reltuples, 0)::float8
        FROM pg_class
        WHERE relkind = 'r'
        ORDER BY reltuples DESC
        LIMIT 30
        """,
    ),
]


def _insert_metric(conn, collected_at, metric_name, entity_type, entity_name, numeric_value, unit):
    conn.execute(
        """
        INSERT INTO postgres_metrics
          (collected_at, metric_name, entity_type, entity_name, numeric_value, unit)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(collected_at, metric_name, entity_type, entity_name) DO UPDATE SET
          numeric_value = excluded.numeric_value,
          unit = excluded.unit
        """,
        (collected_at, metric_name, entity_type, entity_name, float(numeric_value), unit),
    )


def collect(conn):
    collected_at = utc_now()
    with psycopg.connect(os.environ["DATABASE_URL"]) as pg:
        with pg.cursor() as cur:
            for metric_name, entity_type, unit, query in METRIC_QUERIES:
                cur.execute(query)
                for entity_name, numeric_value in cur.fetchall():
                    _insert_metric(conn, collected_at, metric_name, entity_type, entity_name, numeric_value, unit)

            cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'")
            if cur.fetchone():
                cur.execute(
                    """
                    SELECT queryid::text, calls::float8
                    FROM pg_stat_statements
                    ORDER BY calls DESC
                    LIMIT 30
                    """
                )
                for queryid, calls in cur.fetchall():
                    _insert_metric(conn, collected_at, "pg_stat_statements_calls", "query", queryid, calls, "calls")
