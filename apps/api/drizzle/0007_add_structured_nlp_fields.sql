ALTER TABLE articles ADD COLUMN IF NOT EXISTS main_event text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS entities text[];
ALTER TABLE articles ADD COLUMN IF NOT EXISTS topics text[];

ALTER TABLE stories ADD COLUMN IF NOT EXISTS topics text[];
CREATE INDEX IF NOT EXISTS idx_stories_topics ON stories USING gin(topics);
