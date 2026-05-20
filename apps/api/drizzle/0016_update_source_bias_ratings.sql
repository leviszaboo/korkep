UPDATE "sources"
SET "bias_rating" = updates."bias_rating"
FROM (
  VALUES
    ('telex', 'left'),
    ('hvg', 'left'),
    ('blikk', 'center'),
    ('atv', 'center-left'),
    ('vg', 'right'),
    ('mti', 'center-left')
) AS updates("slug", "bias_rating")
WHERE "sources"."slug" = updates."slug";
