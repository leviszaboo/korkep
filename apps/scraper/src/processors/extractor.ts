import * as cheerio from 'cheerio';

export function extractText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, aside, iframe, noscript').remove();
  const text = $('body').text();
  return text.replace(/\s+/g, ' ').trim();
}
