import type { SourceConfig } from './types.js';

export const SOURCES: SourceConfig[] = [
  {
    name: 'Telex',
    slug: 'telex',
    url: 'https://telex.hu',
    rssUrl: 'https://telex.hu/rss',
    biasRating: 'center',
    logoUrl: 'https://telex.hu/favicon-32x32.png',
    scrapeIntervalMinutes: 10,
  },
  {
    name: '444.hu',
    slug: '444',
    url: 'https://444.hu',
    rssUrl: 'https://444.hu/feed',
    biasRating: 'left',
    logoUrl: 'https://cdn.444r.cloud/assets/appicon-180.f28fd1db6b2192fcd860.png',
    scrapeIntervalMinutes: 10,
  },
  {
    name: 'HVG',
    slug: 'hvg',
    url: 'https://hvg.hu',
    rssUrl: 'https://hvg.hu/rss',
    biasRating: 'center-left',
    logoUrl: 'https://cdn.hvg.hu/assets/hvghu/favicon/favicon-96x96.png',
    scrapeIntervalMinutes: 15,
  },
  {
    name: 'Index.hu',
    slug: 'index',
    url: 'https://index.hu',
    rssUrl: 'https://index.hu/24ora/rss/',
    biasRating: 'center',
    logoUrl: 'https://index.hu/assets/images/favicons/favicon-32x32.png',
    scrapeIntervalMinutes: 15,
  },
  {
    name: 'Magyar Nemzet',
    slug: 'magyar-nemzet',
    url: 'https://magyarnemzet.hu',
    rssUrl: 'https://magyarnemzet.hu/publicapi/hu/rss/magyar_nemzet/articles',
    biasRating: 'right',
    logoUrl: 'https://magyarnemzet.hu/favicon-32x32.png',
    scrapeIntervalMinutes: 15,
  },
  {
    name: 'Origo',
    slug: 'origo',
    url: 'https://www.origo.hu',
    rssUrl: 'https://www.origo.hu/publicapi/hu/rss/origo/articles',
    biasRating: 'right',
    logoUrl: 'https://www.origo.hu/favicon-32x32.png',
    scrapeIntervalMinutes: 15,
  },
  {
    name: '24.hu',
    slug: '24hu',
    url: 'https://24.hu',
    rssUrl: 'https://24.hu/feed/',
    biasRating: 'center-left',
    logoUrl: 'https://s.24.hu/apple-touch-icon.png',
    scrapeIntervalMinutes: 15,
  },
  {
    name: 'Mandiner',
    slug: 'mandiner',
    url: 'https://mandiner.hu',
    rssUrl: 'https://mandiner.hu/publicapi/hu/rss/mandiner/articles',
    biasRating: 'right',
    logoUrl: 'https://mandiner.hu/new-favicon-32x32.png',
    scrapeIntervalMinutes: 15,
  },
  {
    name: 'Blikk',
    slug: 'blikk',
    url: 'https://www.blikk.hu',
    rssUrl: 'https://www.blikk.hu/rss',
    biasRating: 'center',
    logoUrl: 'https://www.blikk.hu/favicon-32x32.png',
    scrapeIntervalMinutes: 15,
  },
  {
    name: 'Magyar Hang',
    slug: 'hang',
    url: 'https://hang.hu',
    rssUrl: 'https://hang.hu/rss',
    biasRating: 'center-right',
    logoUrl: 'https://hang.hu/favicon-32x32.png',
    scrapeIntervalMinutes: 20,
  },
];

export const CLUSTERING = {
  similarityThreshold: 0.72,
  timeWindowHours: 24,
  maxClusterSize: 12,
} as const;

export const EMBEDDING = {
  dim: 1024,
  maxInputLength: 1024,
} as const;

export const TOPICS = [
  'politika',
  'világ',
  'gazdaság',
  'társadalom',
  'bűnügyek',
  'sport',
  'kultúra',
  'tudomány',
  'technológia',
  'egészség',
  'időjárás',
  'szórakozás',
  'vélemény',
] as const;

export type Topic = (typeof TOPICS)[number];
