-- Switch embedding model from multilingual-e5-large to qwen3-embedding-8b (both 1024-dim via Matryoshka)
-- Existing embeddings are from the old model and must be regenerated
UPDATE "articles" SET "embedding" = NULL, "story_id" = NULL;
--> statement-breakpoint
DELETE FROM "stories";
