ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS mode TEXT;

UPDATE llm_usage_log
SET mode = CASE
  WHEN provider = 'gemini' THEN 'gemini-fallback'
  ELSE 'openrouter'
END
WHERE mode IS NULL;

ALTER TABLE llm_usage_log ALTER COLUMN mode SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_llm_usage_log_mode ON llm_usage_log (mode);
