import os

import psycopg


QUERY = """
SELECT
  date_trunc('hour', called_at) AS hour,
  COALESCE(activity, '') AS activity,
  COALESCE(mode, '') AS mode,
  COALESCE(provider, '') AS provider,
  COALESCE(model, '') AS model,
  COALESCE(operation, '') AS operation,
  COUNT(*)::bigint AS requests,
  COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
  COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
  COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens
FROM llm_usage_log
WHERE called_at >= now() - (%s::text)::interval
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY 1 DESC
"""


def collect(conn):
    lookback = int(os.environ.get("DIAGNOSTICS_LOOKBACK_HOURS", "24"))
    with psycopg.connect(os.environ["DATABASE_URL"]) as pg:
        with pg.cursor() as cur:
            cur.execute(QUERY, (f"{lookback} hours",))
            for row in cur.fetchall():
                hour = row[0].replace(minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")
                conn.execute(
                    """
                    INSERT INTO llm_usage_hourly
                      (hour, activity, mode, provider, model, operation, requests, prompt_tokens, completion_tokens, total_tokens)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(hour, activity, mode, provider, model, operation) DO UPDATE SET
                      requests = excluded.requests,
                      prompt_tokens = excluded.prompt_tokens,
                      completion_tokens = excluded.completion_tokens,
                      total_tokens = excluded.total_tokens
                    """,
                    (hour, row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9]),
                )
