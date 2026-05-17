ALTER TABLE llm_usage_log ADD COLUMN activity TEXT;

DELETE FROM llm_usage_log WHERE activity IS NULL;

ALTER TABLE llm_usage_log ALTER COLUMN activity SET NOT NULL;

CREATE INDEX idx_llm_usage_log_activity ON llm_usage_log (activity);
