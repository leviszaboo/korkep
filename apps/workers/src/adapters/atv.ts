import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class AtvAdapter extends RssAdapter {
  readonly sourceSlug = 'atv';
  readonly rssUrl = 'https://www.atv.hu/feed/';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, .ad__cont, .ad__code, #protag-player',
    ).remove();

    const body = $('.brxe-post-content p')
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
    return $('meta[property="article:section"]').attr('content')?.trim() || undefined;
  }
}
