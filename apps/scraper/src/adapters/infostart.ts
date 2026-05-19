import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class InfostartAdapter extends RssAdapter {
  readonly sourceSlug = 'infostart';
  readonly rssUrl = 'https://infostart.hu/24ora/rss/';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, iframe, .article-related, .article-soc, .article-meta, .breadcrumb',
    ).remove();

    const body = $('.article-content p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0)
      .join(' ');

    return body.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead = $('.article-lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || this.extractOgDescription(html);
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const breadcrumbLinks = $('.breadcrumb a');
    const category = breadcrumbLinks.length > 1
      ? breadcrumbLinks.last().text()
      : breadcrumbLinks.first().text();
    return category?.trim() || undefined;
  }
}
