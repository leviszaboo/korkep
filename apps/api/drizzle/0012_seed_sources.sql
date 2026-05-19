INSERT INTO "sources" ("name", "slug", "url", "rss_url", "bias_rating", "logo_url")
VALUES
  ('Telex', 'telex', 'https://telex.hu', 'https://telex.hu/rss', 'center', 'https://telex.hu/favicon-32x32.png'),
  ('444.hu', '444', 'https://444.hu', 'https://444.hu/feed', 'left', 'https://cdn.444r.cloud/assets/appicon-180.f28fd1db6b2192fcd860.png'),
  ('HVG', 'hvg', 'https://hvg.hu', 'https://hvg.hu/rss', 'center-left', 'https://cdn.hvg.hu/assets/hvghu/favicon/favicon-96x96.png'),
  ('Index.hu', 'index', 'https://index.hu', 'https://index.hu/24ora/rss/', 'center', 'https://index.hu/assets/images/favicons/favicon-32x32.png'),
  ('Magyar Nemzet', 'magyar-nemzet', 'https://magyarnemzet.hu', 'https://magyarnemzet.hu/publicapi/hu/rss/magyar_nemzet/articles', 'right', 'https://magyarnemzet.hu/favicon-32x32.png'),
  ('Origo', 'origo', 'https://www.origo.hu', 'https://www.origo.hu/publicapi/hu/rss/origo/articles', 'right', 'https://www.origo.hu/favicon-32x32.png'),
  ('24.hu', '24hu', 'https://24.hu', 'https://24.hu/feed/', 'center-left', 'https://s.24.hu/apple-touch-icon.png'),
  ('Mandiner', 'mandiner', 'https://mandiner.hu', 'https://mandiner.hu/publicapi/hu/rss/mandiner/articles', 'right', 'https://mandiner.hu/new-favicon-32x32.png'),
  ('Blikk', 'blikk', 'https://www.blikk.hu', 'https://www.blikk.hu/rss', 'center', 'https://ocdn.eu/blikk_static/resource/icons/new/favicon.ico'),
  ('Magyar Hang', 'hang', 'https://hang.hu', 'https://hang.hu/rss', 'center-right', 'https://hang.hu/favicon.ico'),
  ('Euronews Hungary', 'euronews-hu', 'https://hu.euronews.com', 'https://hu.euronews.com/rss', 'center', 'https://hu.euronews.com/favicon.ico'),
  ('Metropol', 'metropol', 'https://metropol.hu', 'https://metropol.hu/publicapi/hu/rss/metropol/articles', 'right', 'https://metropol.hu/favicon-32x32.png'),
  ('Ripost', 'ripost', 'https://ripost.hu', 'https://ripost.hu/publicapi/hu/rss/ripost/articles', 'right', 'https://ripost.hu/favicon-32x32.png'),
  ('ATV', 'atv', 'https://www.atv.hu', 'https://www.atv.hu/feed/', 'left', 'https://www.atv.hu/wp-content/uploads/2024/11/favicon-1.ico'),
  ('Portfolio', 'portfolio', 'https://www.portfolio.hu', 'https://www.portfolio.hu/rss/all.xml', 'center', 'https://assets.portfolio.hu/images/favicon/favicon-32x32.png'),
  ('Világgazdaság', 'vg', 'https://www.vg.hu', 'https://www.vg.hu/publicapi/hu/rss/vilaggazdasag/articles', 'center-right', 'https://www.vg.hu/favicon-32x32.png'),
  ('Infostart', 'infostart', 'https://infostart.hu', 'https://infostart.hu/24ora/rss/', 'center', 'https://infostart.hu/images/favicon-32x32.png'),
  ('Pesti Srácok', 'pesti-sracok', 'https://pestisracok.hu', 'https://pestisracok.hu/publicapi/hu/rss/pesti_sracok/articles', 'right', 'https://pestisracok.hu/favicon-32x32.png')
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "url" = EXCLUDED."url",
  "rss_url" = EXCLUDED."rss_url",
  "bias_rating" = EXCLUDED."bias_rating",
  "logo_url" = EXCLUDED."logo_url";
