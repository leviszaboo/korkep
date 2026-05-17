ALTER TABLE stories ADD COLUMN IF NOT EXISTS centroid_embedding vector(1024);
ALTER TABLE stories ADD COLUMN IF NOT EXISTS entities text[];
