import type { RawArticle } from '@korkep/shared';

export interface ArticleCandidate {
  url: string;
  title: string;
  sourceSlug: string;
  bodyFallback?: string;
  lead?: string;
  category?: string;
  author?: string;
  imageUrl?: string;
  publishedAt?: Date;
}

export interface ScrapeStats {
  skipped: number;
  fetchFailed: number;
  extractionDegraded: number;
  issues: string[];
}

export abstract class BaseAdapter {
  abstract readonly sourceSlug: string;
  abstract fetchCandidates(maxArticles?: number): Promise<ArticleCandidate[]>;
  abstract extractArticle(candidate: ArticleCandidate): Promise<RawArticle | null>;

  getStats(): ScrapeStats {
    return { skipped: 0, fetchFailed: 0, extractionDegraded: 0, issues: [] };
  }
}
