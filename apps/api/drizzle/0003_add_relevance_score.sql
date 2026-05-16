ALTER TABLE "stories" ADD COLUMN "relevance_score" real DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_stories_relevance" ON "stories" ("relevance_score");
--> statement-breakpoint
-- Backfill: base score from source_count and article_count
UPDATE "stories" SET "relevance_score" = (source_count * 3.0) + (article_count * 1.0);
