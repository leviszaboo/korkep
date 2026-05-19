import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class EuronewsHuAdapter extends RssAdapter {
  readonly sourceSlug = 'euronews-hu';
  readonly rssUrl = 'https://hu.euronews.com/rss';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, .c-ad, .c-article-partage-commentaire, .c-tags-list, .c-live-blogging-post__footer',
    ).remove();

    const body = $('.c-article-content.js-article-content p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0)
      .join(' ');

    return body.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    return this.extractOgDescription(html);
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const section = $('meta[name="article:section"]').attr('content');
    if (section) return section.replace(/_/g, ' ').split(' ').pop()?.trim();
    const vertical = $('meta[name="article:vertical"]').attr('content');
    return vertical?.trim() || undefined;
  }
}
