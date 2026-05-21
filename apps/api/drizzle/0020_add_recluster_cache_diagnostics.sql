ALTER TABLE recluster_decision_cache
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS diagnostics JSONB;
