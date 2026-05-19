import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class KontrollAdapter extends RssAdapter {
  readonly sourceSlug = 'kontroll';
  readonly rssUrl = 'https://kontroll.hu/feed.xml';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, figure, .ad-container').remove();

    const parts: string[] = [];
    $('section.markdown-section p').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 0) parts.push(text);
    });

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const firstStrong = $('section.markdown-section p strong').first().text();
    if (firstStrong?.trim()) return firstStrong.trim();
    return this.extractOgDescription(html);
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const categoryLink = $('a[href^="/rovat/"]').first().text();
    return categoryLink?.trim() || undefined;
  }
}
