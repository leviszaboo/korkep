import * as cheerio from 'cheerio';
import type { RawArticle } from '@korkep/shared';
import { BaseAdapter, type ArticleCandidate, type ScrapeStats } from './base.js';
import { fetchHtml } from '../lib/http.js';
import { logger } from '../logger.js';

const MIN_BODY_LENGTH = 100;

export class MtiAdapter extends BaseAdapter {
  readonly sourceSlug = 'mti';
  private stats: ScrapeStats = { skipped: 0, fetchFailed: 0, extractionDegraded: 0, issues: [] };

  async fetchCandidates(maxArticles?: number): Promise<ArticleCandidate[]> {
    this.stats = { skipped: 0, fetchFailed: 0, extractionDegraded: 0, issues: [] };

    let homepageHtml: string;
    try {
      homepageHtml = await fetchHtml('https://mti.hu');
    } catch (err) {
      logger.error({ err }, 'Failed to fetch mti.hu homepage');
      this.stats.issues.push('Homepage fetch failed');
      return [];
    }

    const $ = cheerio.load(homepageHtml);
    const candidates = new Map<string, ArticleCandidate>();
    $('a[href^="/hirek/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || candidates.has(href)) return;
      const title = $(el).text().replace(/\s+/g, ' ').trim();
      candidates.set(href, {
        url: `https://mti.hu${href}`,
        title: title || href,
        sourceSlug: this.sourceSlug,
      });
    });

    const result = Array.from(candidates.values());
    return maxArticles && maxArticles > 0 ? result.slice(0, maxArticles) : result;
  }

  async extractArticle(candidate: ArticleCandidate): Promise<RawArticle | null> {
    let html: string;
    try {
      html = await fetchHtml(candidate.url);
    } catch (err) {
      logger.debug({ url: candidate.url, err }, 'MTI article fetch failed');
      this.stats.fetchFailed++;
      return null;
    }

    const article$ = cheerio.load(html);

    const title =
      article$('h1').first().text().trim() ||
      article$('meta[property="og:title"]').attr('content')?.trim() ||
      candidate.title;
    if (!title) {
      this.stats.skipped++;
      return null;
    }

    const paragraphs = article$('p.mb-5')
      .map((_, el) => article$(el).text().trim())
      .get()
      .filter((t) => t.length > 0);
    const body = paragraphs.join(' ').replace(/\s+/g, ' ').trim();

    if (body.length < MIN_BODY_LENGTH) {
      this.stats.extractionDegraded++;
      const fallback =
        candidate.bodyFallback ??
        article$('meta[property="og:description"]').attr('content')?.trim();
      if (!fallback) {
        this.stats.skipped++;
        return null;
      }
      return {
        url: candidate.url,
        title,
        body: fallback,
        sourceSlug: this.sourceSlug,
      };
    }

    const lead = paragraphs[0] || undefined;
    const category = article$('meta[name="article:section"]').attr('content')?.trim() || undefined;
    const imageUrl = article$('meta[property="og:image"]').attr('content')?.trim() ||
      article$('meta[name="og:image"]').attr('content')?.trim() || undefined;

    const publishedStr = article$('meta[name="article:published_time"]').attr('content');
    const publishedAt = publishedStr ? new Date(publishedStr) : undefined;

    return {
      url: candidate.url,
      title,
      body,
      lead,
      category,
      imageUrl,
      publishedAt,
      sourceSlug: this.sourceSlug,
    };
  }

  getStats(): ScrapeStats {
    return this.stats;
  }
}
