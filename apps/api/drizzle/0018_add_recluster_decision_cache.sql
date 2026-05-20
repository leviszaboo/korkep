CREATE TABLE IF NOT EXISTS recluster_decision_cache (
  fingerprint TEXT PRIMARY KEY,
  article_ids INTEGER[] NOT NULL,
  coherent BOOLEAN NOT NULL,
  title TEXT,
  summary TEXT,
  groups JSONB,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recluster_decision_cache_last_used
  ON recluster_decision_cache (last_used_at);
