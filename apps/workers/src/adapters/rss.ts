import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import type { RawArticle } from '@korkep/shared';
import { BaseAdapter, type ArticleCandidate, type ScrapeStats } from './base.js';
import { fetchHtml } from '../lib/http.js';
import { logger } from '../logger.js';

const parser = new Parser();

const MIN_BODY_LENGTH = 100;
const MIN_CONTENT_RATIO = 0.01;

interface ExtractionResult {
  body?: string;
  lead?: string;
  category?: string;
  imageUrl?: string;
  quality: 'good' | 'degraded' | 'fallback';
}

export abstract class RssAdapter extends BaseAdapter {
  abstract readonly rssUrl: string;
  private stats: ScrapeStats = { skipped: 0, fetchFailed: 0, extractionDegraded: 0, issues: [] };

  async fetchCandidates(maxArticles?: number): Promise<ArticleCandidate[]> {
    this.stats = { skipped: 0, fetchFailed: 0, extractionDegraded: 0, issues: [] };
    const feed = await parser.parseURL(this.rssUrl);

    return limitRssItems(
      feed.items.filter((item) => item.link && item.title),
      maxArticles,
    ).map((item) => rssItemToCandidate(item, this.sourceSlug));
  }

  async extractArticle(candidate: ArticleCandidate): Promise<RawArticle | null> {
    const extraction = await this.extractFromHtml(candidate);

    if (!extraction.body && !candidate.bodyFallback) {
      logger.debug(
        { url: candidate.url, source: this.sourceSlug, quality: extraction.quality },
        'No body content extracted, skipping article',
      );
      this.stats.skipped++;
      return null;
    }

    return {
      url: candidate.url,
      title: candidate.title,
      body: extraction.body || candidate.bodyFallback || undefined,
      lead: extraction.lead ?? candidate.lead,
      category: extraction.category ?? candidate.category,
      author: candidate.author,
      imageUrl: extraction.imageUrl ?? candidate.imageUrl,
      publishedAt: candidate.publishedAt,
      sourceSlug: candidate.sourceSlug,
    };
  }

  getStats(): ScrapeStats {
    return this.stats;
  }

  private async extractFromHtml(candidate: ArticleCandidate): Promise<ExtractionResult> {
    let html: string;
    try {
      html = await fetchHtml(candidate.url);
    } catch (err) {
      logger.debug({ url: candidate.url, err }, 'HTML fetch failed');
      this.stats.fetchFailed++;
      return { quality: 'fallback' };
    }

    const body = this.extractBody(html);
    const lead = this.extractLead(html);
    const category = this.extractCategory(html);
    const imageUrl = this.extractOgImage(html);

    if (!body || body.length < MIN_BODY_LENGTH) {
      logger.debug(
        { url: candidate.url, source: this.sourceSlug, bodyLength: body?.length ?? 0 },
        'Body extraction too short — selector may be broken',
      );
      this.stats.extractionDegraded++;
      return {
        body: candidate.bodyFallback,
        lead,
        category,
        imageUrl,
        quality: 'degraded',
      };
    }

    const contentRatio = body.length / html.length;
    if (contentRatio < MIN_CONTENT_RATIO) {
      logger.debug(
        { url: candidate.url, source: this.sourceSlug, contentRatio: contentRatio.toFixed(4) },
        'Content ratio suspiciously low — possible paywall or wrong page',
      );
    }

    const $ = cheerio.load(html);
    const pageTitle = $('title').text() || $('meta[property="og:title"]').attr('content') || '';
    if (pageTitle && candidate.title && !this.titlesMatch(candidate.title, pageTitle)) {
      logger.debug(
        { url: candidate.url, rssTitle: candidate.title, pageTitle },
        'RSS title does not match page title',
      );
    }

    return { body, lead, category, imageUrl, quality: 'good' };
  }

  private titlesMatch(rssTitle: string, pageTitle: string): boolean {
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 50);
    const rssNorm = normalize(rssTitle);
    const pageNorm = normalize(pageTitle);
    return pageNorm.includes(rssNorm.slice(0, 30)) || rssNorm.includes(pageNorm.slice(0, 30));
  }

  abstract extractBody(html: string): string;

  extractLead(_html: string): string | undefined {
    return undefined;
  }

  extractCategory(_html: string): string | undefined {
    return undefined;
  }

  protected extractOgDescription(html: string): string | undefined {
    const $ = cheerio.load(html);
    const ogDesc =
      $('meta[property="og:description"]').attr('content') ??
      $('meta[name="description"]').attr('content');
    return ogDesc?.trim() || undefined;
  }

  protected extractOgImage(html: string): string | undefined {
    const $ = cheerio.load(html);
    return $('meta[property="og:image"]').attr('content')?.trim() || undefined;
  }

}

export function limitRssItems<T>(items: T[], maxItems?: number): T[] {
  if (!maxItems || maxItems <= 0) return items;
  return items.slice(0, maxItems);
}

export function rssItemToCandidate(item: Parser.Item, sourceSlug: string): ArticleCandidate {
  const itemWithAuthor = item as Parser.Item & { author?: string };
  const candidate: ArticleCandidate = {
    url: item.link!,
    title: item.title!,
    bodyFallback: item.contentSnippet || item.content || undefined,
    category: extractItemCategory(item),
    author: item.creator ?? itemWithAuthor.author ?? undefined,
    imageUrl: extractItemImageUrl(item),
    publishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
    sourceSlug,
  };

  return candidate;
}

function extractItemCategory(item: Parser.Item): string | undefined {
  if (!item.categories?.length) return undefined;
  const firstCategory = item.categories[0];
  return typeof firstCategory === 'string'
    ? firstCategory
    : (firstCategory && typeof firstCategory === 'object' && 'name' in firstCategory
        ? (firstCategory as any).name
        : undefined);
}

function extractItemImageUrl(item: Parser.Item): string | undefined {
  const enclosure = item.enclosure;
  if (enclosure?.url && enclosure.type?.startsWith('image/')) {
    return enclosure.url;
  }
  return undefined;
}
