CREATE TABLE IF NOT EXISTS article_discard_log (
  id SERIAL PRIMARY KEY,
  source_id INTEGER REFERENCES sources(id),
  source_slug TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  reason TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  confidence REAL NOT NULL,
  stage TEXT NOT NULL,
  published_at TIMESTAMP WITH TIME ZONE,
  discarded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_discard_log_url ON article_discard_log (url);
CREATE INDEX IF NOT EXISTS idx_article_discard_log_discarded_at ON article_discard_log (discarded_at);
CREATE INDEX IF NOT EXISTS idx_article_discard_log_source_slug ON article_discard_log (source_slug);
CREATE INDEX IF NOT EXISTS idx_article_discard_log_rule_id ON article_discard_log (rule_id);

