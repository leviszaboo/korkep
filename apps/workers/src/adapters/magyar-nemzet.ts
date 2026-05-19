import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class MagyarNemzetAdapter extends RssAdapter {
  readonly sourceSlug = 'magyar-nemzet';
  readonly rssUrl = 'https://magyarnemzet.hu/publicapi/hu/rss/magyar_nemzet/articles';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, .article-embed-pr-advert, .article-tags, .article-card, .external-recommendations, kesma-advertisement-adocean',
    ).remove();

    const parts: string[] = [];
    $('.article-text-formatter').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 0) parts.push(text);
    });
    const articleBody = parts.join(' ') || $('article.article').text();

    return articleBody.replace(/\s+/g, ' ').trim();
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
      $('.label.first').first().text();
    return category?.trim() || undefined;
  }
}
