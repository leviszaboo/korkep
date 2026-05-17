CREATE TABLE IF NOT EXISTS llm_usage_log (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  operation TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  called_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_llm_usage_log_called_at ON llm_usage_log (called_at);
