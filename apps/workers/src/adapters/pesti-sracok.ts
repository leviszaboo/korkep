import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class PestiSracokAdapter extends RssAdapter {
  readonly sourceSlug = 'pesti-sracok';
  readonly rssUrl = 'https://pestisracok.hu/publicapi/hu/rss/pesti_sracok/articles';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $(
      'script, style, nav, header, footer, .article-card, .external-recommendations, kesma-advertisement-adocean, figure',
    ).remove();

    const body = $('.block-content').text();

    return body.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead = $('.article-lead').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || this.extractOgDescription(html);
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    const category = $('.article-column').first().text();
    return category?.trim() || undefined;
  }
}
