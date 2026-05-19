export type BiasRating = 'left' | 'center-left' | 'center' | 'center-right' | 'right';

export interface Source {
  id: number;
  name: string;
  slug: string;
  url: string;
  rssUrl: string | null;
  biasRating: BiasRating;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: Date;
}

export type ArticleType = 'event' | 'aggregation' | 'opinion' | 'background';

export interface ArticleAnalysis {
  summary: string;
  headline: string;
  mainEvent: string;
  storyIdentity: string;
  articleType: ArticleType;
  location: string | null;
  entities: string[];
  topics: string[];
}

export interface Article {
  id: number;
  sourceId: number;
  url: string;
  title: string;
  body: string | null;
  lead: string | null;
  summary: string | null;
  mainEvent: string | null;
  location: string | null;
  entities: string[] | null;
  topics: string[] | null;
  category: string | null;
  author: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
  scrapedAt: Date;
  fingerprint: string;
  embedding: number[] | null;
  storyId: number | null;
  createdAt: Date;
}

export interface Story {
  id: number;
  title: string;
  summary: string | null;
  topic: string | null;
  articleCount: number;
  sourceCount: number;
  relevanceScore: number;
  firstSeenAt: Date;
  updatedAt: Date;
  createdAt: Date;
}

export interface RawArticle {
  url: string;
  title: string;
  body?: string;
  lead?: string;
  category?: string;
  author?: string;
  imageUrl?: string;
  publishedAt?: Date;
  sourceSlug: string;
}

export interface SourceConfig {
  name: string;
  slug: string;
  url: string;
  rssUrl: string | null;
  biasRating: BiasRating;
  logoUrl: string | null;
}
