CREATE TABLE "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"author" text,
	"image_url" text,
	"published_at" timestamp with time zone,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fingerprint" text NOT NULL,
	"embedding" vector(384),
	"story_id" integer,
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"url" text NOT NULL,
	"rss_url" text,
	"bias_rating" text NOT NULL,
	"logo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"topic" text,
	"article_count" integer DEFAULT 1 NOT NULL,
	"source_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_articles_source" ON "articles" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_articles_published" ON "articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_articles_story" ON "articles" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "idx_articles_fingerprint" ON "articles" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "idx_stories_updated" ON "stories" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_stories_topic" ON "stories" USING btree ("topic");