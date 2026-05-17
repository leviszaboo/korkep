import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class VgAdapter extends RssAdapter {
  readonly sourceSlug = 'vg';
  readonly rssUrl = 'https://www.vg.hu/publicapi/hu/rss/vilaggazdasag/articles';

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
    const tag = $('.article-tag').first().text();
    return tag?.trim() || undefined;
  }
}
