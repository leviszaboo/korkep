import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class HangAdapter extends RssAdapter {
  readonly sourceSlug = 'hang';
  readonly rssUrl = 'https://hang.hu/rss';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, figure, .banner-wrapper, .ads-section').remove();

    const body = $('.post-content p')
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
    const breadcrumbLinks = $('.breadcrumb a');
    if (breadcrumbLinks.length >= 2) {
      const category = $(breadcrumbLinks[1]).text().trim();
      if (category) return category;
    }
    return undefined;
  }
}
