import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class MandinerAdapter extends RssAdapter {
  readonly sourceSlug = 'mandiner';
  readonly rssUrl = 'https://mandiner.hu/publicapi/hu/rss/mandiner/articles';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, .article-card, .article-break-news, .external-recommendations, kesma-advertisement-adocean, .newsletter-diverter-card',
    ).remove();

    // Only body text, not the lead (extracted separately)
    const body = $('.block-content').text();

    return body.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead = $('.article-page-lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || undefined;
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const category =
      $('meta[property="article:section"]').attr('content') ||
      $('.article-card-category').first().text();
    return category?.trim() || undefined;
  }
}
