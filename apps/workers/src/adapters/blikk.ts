import * as cheerio from 'cheerio';
import { RssAdapter } from './rss.js';

export class BlikkAdapter extends RssAdapter {
  readonly sourceSlug = 'blikk';
  readonly rssUrl = 'https://www.blikk.hu/rss';

  extractBody(html: string): string {
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, .banner-container, .bannerDesktopContainer, .tagArticles').remove();

    const body = $('article section.text-base').text();

    return body.replace(/\s+/g, ' ').trim();
  }

  extractLead(html: string): string | undefined {
    const $ = cheerio.load(html);
    const lead = $('article section.lead-text').first().text();
    return lead?.replace(/\s+/g, ' ').trim() || undefined;
  }

  extractCategory(html: string): string | undefined {
    const $ = cheerio.load(html);
    return $('meta[property="article:section"]').attr('content')?.trim() || undefined;
  }
}
