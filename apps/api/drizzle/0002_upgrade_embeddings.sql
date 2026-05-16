-- Drop existing embeddings (they're 768-dim, incompatible with new 1024-dim model)
UPDATE "articles" SET "embedding" = NULL;
--> statement-breakpoint
-- Change vector dimension from 768 to 1024
ALTER TABLE "articles" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);
--> statement-breakpoint
-- Add HNSW index for fast approximate nearest neighbor search
CREATE INDEX "idx_articles_embedding" ON "articles" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
