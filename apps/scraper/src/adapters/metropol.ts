import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class MetropolAdapter extends RssAdapter {
  readonly sourceSlug = 'metropol';
  readonly rssUrl = 'https://metropol.hu/publicapi/hu/rss/metropol/articles';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, .article-card, .external-recommendations, kesma-advertisement-adocean, figure',
    ).remove();

    const body = $('.block-content').text();

    return body.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead = $('.article-header-lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || undefined;
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const category = $('.article-header-category').first().text();
    return category?.trim() || undefined;
  }
}
