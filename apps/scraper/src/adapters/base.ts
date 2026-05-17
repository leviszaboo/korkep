import type { RawArticle } from '@korkep/shared';

export interface ScrapeStats {
  skipped: number;
  fetchFailed: number;
  extractionDegraded: number;
  issues: string[];
}

export abstract class BaseAdapter {
  abstract readonly sourceSlug: string;
  abstract fetchArticles(): Promise<RawArticle[]>;
  getStats(): ScrapeStats {
    return { skipped: 0, fetchFailed: 0, extractionDegraded: 0, issues: [] };
  }
}
