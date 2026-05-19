-- Update bias ratings for existing sources
UPDATE "sources" SET "bias_rating" = 'center-right' WHERE "slug" = 'index';
UPDATE "sources" SET "bias_rating" = 'center-right' WHERE "slug" = 'blikk';
UPDATE "sources" SET "bias_rating" = 'center' WHERE "slug" = 'hang';

-- Add new sources
INSERT INTO "sources" ("name", "slug", "url", "rss_url", "bias_rating", "logo_url")
VALUES
  ('MTI', 'mti', 'https://mti.hu', '', 'center-right', 'https://mti.hu/favicon-32x32.png'),
  ('Kontroll', 'kontroll', 'https://kontroll.hu', 'https://kontroll.hu/feed.xml', 'center-left', 'https://kontroll.hu/favicon.ico'),
  ('Demokrata', 'demokrata', 'https://demokrata.hu', 'https://demokrata.hu/feed', 'right', 'https://demokrata.hu/favicon.ico')
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "url" = EXCLUDED."url",
  "rss_url" = EXCLUDED."rss_url",
  "bias_rating" = EXCLUDED."bias_rating",
  "logo_url" = EXCLUDED."logo_url";
