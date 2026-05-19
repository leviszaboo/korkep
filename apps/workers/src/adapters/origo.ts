import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class OrigoAdapter extends RssAdapter {
  readonly sourceSlug = 'origo';
  readonly rssUrl = 'https://www.origo.hu/publicapi/hu/rss/origo/articles';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, .article-embed-pr-advert, .article-tags, .article-card, .external-recommendations, kesma-advertisement-adocean, .article-meta',
    ).remove();

    const parts: string[] = [];
    $('.block-content').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 0) parts.push(text);
    });
    const body = parts.join(' ') || $('article.article').text();

    return body.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead = $('.article-lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || undefined;
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const category =
      $('meta[property="article:section"]').attr('content') ||
      $('a.tag[href*="/rovat/"]').first().text();
    return category?.trim() || undefined;
  }
}
