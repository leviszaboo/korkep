export type BiasRating = 'left' | 'center-left' | 'center' | 'center-right' | 'right';

export interface BiasCounts {
  left: number;
  center: number;
  right: number;
}

export interface StorySource {
  name: string;
  slug: string;
  biasRating: BiasRating;
  logoUrl: string | null;
}

export interface Story {
  id: number;
  title: string;
  summary: string | null;
  topic: string | null;
  topics: string[] | null;
  articleCount: number;
  sourceCount: number;
  relevanceScore: number;
  imageUrl: string | null;
  firstSeenAt: string;
  updatedAt: string;
  latestPublishedAt: string;
  createdAt: string;
  sourceBias: BiasCounts;
  sources: StorySource[];
}

export interface Article {
  id: number;
  title: string;
  summary: string | null;
  mainEvent: string | null;
  location: string | null;
  entities: string[] | null;
  topics: string[] | null;
  author: string | null;
  url: string;
  imageUrl: string | null;
  publishedAt: string | null;
  source: {
    name: string;
    slug: string;
    biasRating: BiasRating;
    logoUrl: string | null;
  };
}

export interface StoryDetail extends Omit<Story, 'sourceBias' | 'sources' | 'imageUrl'> {
  articles: Article[];
}

export interface Source {
  id: number;
  name: string;
  slug: string;
  url: string;
  biasRating: BiasRating;
  logoUrl: string | null;
  articleCount: number;
}

export interface SearchResult {
  storyId: number;
  storyTitle: string;
  storySummary: string | null;
  storyTopics: string[] | null;
  sourceCount: number;
  articleCount: number;
  imageUrl: string | null;
  latestPublishedAt: string;
  matchedArticles: number;
  relevanceScore: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}
