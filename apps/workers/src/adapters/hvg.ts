import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class HvgAdapter extends RssAdapter {
  readonly sourceSlug = 'hvg';
  readonly rssUrl = 'https://hvg.hu/rss';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, .closing-widget, .paid-body, .social-content, .tags, .article-card',
    ).remove();

    // Only body text, not the lead (extracted separately)
    const body = $('.free-body.content-body').text() || $('.content-body').text();

    return body.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead = $('.lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || undefined;
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const category =
      $('meta[property="article:section"]').attr('content') ||
      $('a[href*="/rovat/"]').first().text();
    return category?.trim() || undefined;
  }
}
