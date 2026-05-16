import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import type { RawArticle } from '@korkep/shared';
import { BaseAdapter } from './base.js';
import { fetchHtml } from '../lib/http.js';
import { logger } from '../logger.js';

const parser = new Parser();

const MIN_BODY_LENGTH = 100;
const MIN_CONTENT_RATIO = 0.03;

interface ExtractionResult {
  body?: string;
  lead?: string;
  category?: string;
  imageUrl?: string;
  quality: 'good' | 'degraded' | 'fallback';
}

export abstract class RssAdapter extends BaseAdapter {
  abstract readonly rssUrl: string;

  async fetchArticles(): Promise<RawArticle[]> {
    const feed = await parser.parseURL(this.rssUrl);
    const articles: RawArticle[] = [];

    for (const item of feed.items) {
      if (!item.link || !item.title) continue;

      const extraction = await this.extractFromHtml(item);

      if (!extraction.body && !item.contentSnippet) {
        logger.warn(
          { url: item.link, source: this.sourceSlug, quality: extraction.quality },
          'No body content extracted, skipping article',
        );
        continue;
      }

      if (!extraction.category && item.categories?.length) {
        extraction.category = item.categories[0] as string;
      }

      articles.push({
        url: item.link,
        title: item.title,
        body: extraction.body || item.contentSnippet || undefined,
        lead: extraction.lead,
        category: extraction.category,
        author: item.creator ?? item.author ?? undefined,
        imageUrl: extraction.imageUrl ?? this.extractImageUrl(item),
        publishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
        sourceSlug: this.sourceSlug,
      });
    }

    return articles;
  }

  private async extractFromHtml(item: Parser.Item): Promise<ExtractionResult> {
    let html: string;
    try {
      html = await fetchHtml(item.link!);
    } catch (err) {
      logger.warn({ url: item.link, err }, 'HTML fetch failed');
      return { quality: 'fallback' };
    }

    const body = this.extractBody(html);
    const lead = this.extractLead(html);
    const category = this.extractCategory(html);
    const imageUrl = this.extractOgImage(html);

    if (!body || body.length < MIN_BODY_LENGTH) {
      logger.warn(
        { url: item.link, source: this.sourceSlug, bodyLength: body?.length ?? 0 },
        'Body extraction too short — selector may be broken',
      );
      return {
        body: item.contentSnippet ?? item.content ?? undefined,
        lead,
        category,
        imageUrl,
        quality: 'degraded',
      };
    }

    const contentRatio = body.length / html.length;
    if (contentRatio < MIN_CONTENT_RATIO) {
      logger.warn(
        { url: item.link, source: this.sourceSlug, contentRatio: contentRatio.toFixed(4) },
        'Content ratio suspiciously low — possible paywall or wrong page',
      );
    }

    const $ = cheerio.load(html);
    const pageTitle = $('title').text() || $('meta[property="og:title"]').attr('content') || '';
    if (pageTitle && item.title && !this.titlesMatch(item.title, pageTitle)) {
      logger.debug(
        { url: item.link, rssTitle: item.title, pageTitle },
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

  protected extractImageUrl(item: Parser.Item): string | undefined {
    const enclosure = item.enclosure;
    if (enclosure?.url && enclosure.type?.startsWith('image/')) {
      return enclosure.url;
    }
    return undefined;
  }
}
