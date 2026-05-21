ALTER TABLE article_discard_log
  ADD COLUMN IF NOT EXISTS detector TEXT NOT NULL DEFAULT 'classifier';

CREATE INDEX IF NOT EXISTS idx_article_discard_log_detector
  ON article_discard_log (detector);
