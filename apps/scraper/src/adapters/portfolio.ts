import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class PortfolioAdapter extends RssAdapter {
  readonly sourceSlug = 'portfolio';
  readonly rssUrl = 'https://www.portfolio.hu/rss/all.xml';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, .adoceanzone, .pf-article, .share, .article-save',
    ).remove();

    const body = $('.pfarticle-section-content p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0)
      .join(' ');

    return body.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead = $('.pfarticle-section-lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || undefined;
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const category = $('article.pfarticle').closest('.container').find('.badge a').first().text();
    if (category?.trim()) return category.trim();
    return $('.overlay-content .badge a').first().text()?.trim() || undefined;
  }
}
