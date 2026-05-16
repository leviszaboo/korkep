import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class TelexAdapter extends RssAdapter {
  readonly sourceSlug = 'telex';
  readonly rssUrl = 'https://telex.hu/rss';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, figure, .article-ad, .related-articles').remove();

    const articleBody =
      $('.article-html-content').text() ||
      $('.article_body_').text() ||
      $('.single-article__content').text();

    return articleBody.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead =
      $('.article-lead').first().text() ||
      $('.article__lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || this.extractOgDescription(html);
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const category =
      $('meta[property="article:section"]').attr('content') ||
      $('a[href*="/rovat/"]').first().text() ||
      $('.tag').first().text();
    return category?.trim() || undefined;
  }
}
