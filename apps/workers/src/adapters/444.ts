import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class FourFourFourAdapter extends RssAdapter {
  readonly sourceSlug = '444';
  readonly rssUrl = 'https://444.hu/feed';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, figure, figcaption').remove();

    const articleBody = $('.slotArticle').text() || $('article').text();

    return articleBody.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    // 444 uses the first paragraph of the article as the lead
    const lead =
      $('.slotArticle p').first().text() ||
      $('article p').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || undefined;
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const category =
      $('meta[property="article:section"]').attr('content') ||
      $('.article-category').first().text() ||
      $('a[href*="/tag/"]').first().text();
    return category?.trim() || undefined;
  }
}
