import type { RawArticle } from '@korkep/shared';

export abstract class BaseAdapter {
  abstract readonly sourceSlug: string;
  abstract fetchArticles(): Promise<RawArticle[]>;
}
