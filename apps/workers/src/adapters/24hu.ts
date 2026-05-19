import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class TwentyFourHuAdapter extends RssAdapter {
  readonly sourceSlug = '24hu';
  readonly rssUrl = 'https://24.hu/feed/';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, .o-post__authorShare, .m-articleWidget, .banner-container, .highlight-block, .article_box_border_szponzibox',
    ).remove();

    // Only body text, not the lead (extracted separately)
    const body = $('.o-post__body').text() || $('.post-body').text();

    return body.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead = $('.o-post__lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || undefined;
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const category =
      $('meta[property="article:section"]').attr('content') ||
      $('.o-post__category a').first().text();
    return category?.trim() || undefined;
  }
}
