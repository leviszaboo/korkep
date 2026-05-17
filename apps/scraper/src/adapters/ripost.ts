import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class RipostAdapter extends RssAdapter {
  readonly sourceSlug = 'ripost';
  readonly rssUrl = 'https://ripost.hu/publicapi/hu/rss/ripost/articles';

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
    const lead = $('.article-lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || undefined;
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const category = $('.article-header-label-text').first().text();
    return category?.trim() || undefined;
  }
}
