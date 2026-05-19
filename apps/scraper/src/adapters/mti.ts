import * as cheerio from 'cheerio';
import type { RawArticle } from '@korkep/shared';
import { BaseAdapter, type ScrapeStats } from './base.js';
import { fetchHtml } from '../lib/http.js';
import { logger } from '../logger.js';

const MIN_BODY_LENGTH = 100;

export class MtiAdapter extends BaseAdapter {
  readonly sourceSlug = 'mti';
  private stats: ScrapeStats = { skipped: 0, fetchFailed: 0, extractionDegraded: 0, issues: [] };

  async fetchArticles(): Promise<RawArticle[]> {
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
    const articleUrls = new Set<string>();
    $('a[href^="/hirek/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) articleUrls.add(href);
    });

    const articles: RawArticle[] = [];

    for (const path of articleUrls) {
      const url = `https://mti.hu${path}`;
      let html: string;
      try {
        html = await fetchHtml(url);
      } catch (err) {
        logger.debug({ url, err }, 'MTI article fetch failed');
        this.stats.fetchFailed++;
        continue;
      }

      const article$ = cheerio.load(html);

      const title =
        article$('h1').first().text().trim() ||
        article$('meta[property="og:title"]').attr('content')?.trim();
      if (!title) {
        this.stats.skipped++;
        continue;
      }

      const paragraphs = article$('p.mb-5')
        .map((_, el) => article$(el).text().trim())
        .get()
        .filter((t) => t.length > 0);
      const body = paragraphs.join(' ').replace(/\s+/g, ' ').trim();

      if (body.length < MIN_BODY_LENGTH) {
        this.stats.extractionDegraded++;
        const fallback = article$('meta[property="og:description"]').attr('content')?.trim();
        if (!fallback) {
          this.stats.skipped++;
          continue;
        }
        articles.push({
          url,
          title,
          body: fallback,
          sourceSlug: this.sourceSlug,
        });
        continue;
      }

      const lead = paragraphs[0] || undefined;
      const category = article$('meta[name="article:section"]').attr('content')?.trim() || undefined;
      const imageUrl = article$('meta[property="og:image"]').attr('content')?.trim() ||
        article$('meta[name="og:image"]').attr('content')?.trim() || undefined;

      const publishedStr = article$('meta[name="article:published_time"]').attr('content');
      const publishedAt = publishedStr ? new Date(publishedStr) : undefined;

      articles.push({
        url,
        title,
        body,
        lead,
        category,
        imageUrl,
        publishedAt,
        sourceSlug: this.sourceSlug,
      });
    }

    return articles;
  }

  getStats(): ScrapeStats {
    return this.stats;
  }
}
