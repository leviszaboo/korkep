import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class DemokrataAdapter extends RssAdapter {
  readonly sourceSlug = 'demokrata';
  readonly rssUrl = 'https://demokrata.hu/feed';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, figure, .ad-container, .article-tags, .related-articles').remove();

    const body =
      $('.article-body p, .entry-content p, .field--name-body p, article p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter((t) => t.length > 0)
        .join(' ');

    return body.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead =
      $('.article-lead').first().text() ||
      $('.field--name-field-lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || this.extractOgDescription(html);
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    return (
      $('meta[property="article:section"]').attr('content')?.trim() ||
      $('a[href*="/rovat/"]').first().text()?.trim() ||
      undefined
    );
  }
}
