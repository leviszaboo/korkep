-- Auto-populate search_vector on article insert/update
CREATE OR REPLACE FUNCTION articles_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.body, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_articles_search_vector ON articles;
--> statement-breakpoint
CREATE TRIGGER trg_articles_search_vector
  BEFORE INSERT OR UPDATE OF title, body ON articles
  FOR EACH ROW EXECUTE FUNCTION articles_search_vector_update();
--> statement-breakpoint
-- Backfill existing articles
UPDATE articles SET search_vector =
  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(body, '')), 'B')
WHERE search_vector IS NULL;
--> statement-breakpoint
-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_articles_search_vector ON articles USING gin(search_vector);
