import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class IndexHuAdapter extends RssAdapter {
  readonly sourceSlug = 'index';
  readonly rssUrl = 'https://index.hu/24ora/rss/';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, .ad-container, .cikk-bottom-text-ad, .cikk-vegi-ajanlo-reklamok, .cikk-cimkek, .cikk-inline-ad, .indaContrecWidget',
    ).remove();

    const articleBody = $('.cikk-torzs').text() || $('.content').text();

    return articleBody.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead =
      $('.cikk-lead').first().text() ||
      $('.lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || undefined;
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const category =
      $('meta[property="article:section"]').attr('content') ||
      $('.cikk-rovat').first().text();
    if (category?.trim()) return category.trim();

    const bodyClass = $('body').attr('class') ?? '';
    const match = bodyClass.match(/rovat_(\w+)/);
    return match?.[1]?.replace(/_/g, ' ') || undefined;
  }
}
