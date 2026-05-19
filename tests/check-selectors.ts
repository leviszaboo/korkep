import Parser from 'rss-parser';
import * as cheerio from 'cheerio';

const USER_AGENT = 'KorkepBot/0.1 (+https://korkep.hu)';
const TIMEOUT_MS = 15_000;

const parser = new Parser();

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

interface SelectorCheck {
  name: string;
  selector: string;
  found: boolean;
  textLength: number;
  preview: string;
}

interface AdapterDef {
  slug: string;
  rssUrl: string;
  bodySelectors: string[];
  leadSelectors: string[];
  categorySelectors: string[];
  removeSelectors: string[];
}

const adapters: AdapterDef[] = [
  {
    slug: 'telex',
    rssUrl: 'https://telex.hu/rss',
    bodySelectors: ['.article-html-content', '.article_body_', '.single-article__content'],
    leadSelectors: ['.article-lead', '.article__lead'],
    categorySelectors: ['meta[property="article:section"]', '.article-tag'],
    removeSelectors: ['.article-ad', '.related-articles'],
  },
  {
    slug: 'hvg',
    rssUrl: 'https://hvg.hu/rss',
    bodySelectors: ['.free-body.content-body', '.content-body'],
    leadSelectors: ['.lead'],
    categorySelectors: ['meta[property="article:section"]', '.article-superheadline a'],
    removeSelectors: ['.closing-widget', '.paid-body', '.social-content', '.tags', '.article-card'],
  },
  {
    slug: 'origo',
    rssUrl: 'https://www.origo.hu/publicapi/hu/rss/origo/articles',
    bodySelectors: ['origo-wysiwyg-box .block-content', 'article.article'],
    leadSelectors: ['.article-lead'],
    categorySelectors: ['meta[property="article:section"]', '.article-rubric'],
    removeSelectors: ['.article-embed-pr-advert', '.article-tags', '.article-card', '.external-recommendations'],
  },
  {
    slug: '444',
    rssUrl: 'https://444.hu/feed',
    bodySelectors: ['.slotArticle', 'article'],
    leadSelectors: ['.slotArticle p:first-of-type', 'article p:first-of-type'],
    categorySelectors: ['meta[property="article:section"]', '.article-category', 'a.tag'],
    removeSelectors: [],
  },
  {
    slug: 'index',
    rssUrl: 'https://index.hu/24ora/rss/',
    bodySelectors: ['.cikk-torzs', '.content'],
    leadSelectors: ['.cikk-lead', '.lead'],
    categorySelectors: ['meta[property="article:section"]', '.cikk-rovat'],
    removeSelectors: ['.ad-container', '.cikk-bottom-text-ad', '.cikk-vegi-ajanlo-reklamok', '.cikk-cimkek', '.cikk-inline-ad'],
  },
  {
    slug: 'magyar-nemzet',
    rssUrl: 'https://magyarnemzet.hu/publicapi/hu/rss/magyar_nemzet/articles',
    bodySelectors: ['.article-text-formatter', 'article.article'],
    leadSelectors: ['.article-lead'],
    categorySelectors: ['meta[property="article:section"]', '.article-rubric'],
    removeSelectors: ['.article-embed-pr-advert', '.article-tags', '.article-card', '.external-recommendations'],
  },
  {
    slug: 'mandiner',
    rssUrl: 'https://mandiner.hu/publicapi/hu/rss/mandiner/articles',
    bodySelectors: ['.block-content'],
    leadSelectors: ['.article-page-lead'],
    categorySelectors: ['meta[property="article:section"]', '.article-rubric'],
    removeSelectors: ['.article-card', '.article-break-news', '.external-recommendations', '.newsletter-diverter-card'],
  },
  {
    slug: '24hu',
    rssUrl: 'https://24.hu/feed/',
    bodySelectors: ['.o-post__body', '.post-body'],
    leadSelectors: ['.o-post__lead'],
    categorySelectors: ['meta[property="article:section"]', '.o-post__category a'],
    removeSelectors: ['.o-post__authorShare', '.m-articleWidget', '.banner-container', '.highlight-block'],
  },
  {
    slug: 'infostart',
    rssUrl: 'https://infostart.hu/24ora/rss/',
    bodySelectors: ['.article-content', '.article-content p'],
    leadSelectors: ['.article-lead'],
    categorySelectors: ['.breadcrumb a'],
    removeSelectors: ['iframe', '.article-related', '.article-soc', '.article-meta', '.breadcrumb'],
  },
  {
    slug: 'pesti-sracok',
    rssUrl: 'https://pestisracok.hu/publicapi/hu/rss/pesti_sracok/articles',
    bodySelectors: ['.block-content'],
    leadSelectors: ['.article-lead'],
    categorySelectors: ['.article-column'],
    removeSelectors: ['.article-card', '.external-recommendations', 'figure'],
  },
];

function checkSelectors(html: string, selectors: string[], label: string): SelectorCheck[] {
  const $ = cheerio.load(html);
  return selectors.map((sel) => {
    const el = $(sel);
    const text = sel.startsWith('meta[') ? (el.attr('content') ?? '') : el.first().text();
    const trimmed = text.replace(/\s+/g, ' ').trim();
    return {
      name: `${label}: ${sel}`,
      selector: sel,
      found: el.length > 0,
      textLength: trimmed.length,
      preview: trimmed.slice(0, 120),
    };
  });
}

async function checkAdapter(adapter: AdapterDef) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`SOURCE: ${adapter.slug.toUpperCase()}`);
  console.log(`RSS: ${adapter.rssUrl}`);
  console.log('='.repeat(70));

  let feed;
  try {
    feed = await parser.parseURL(adapter.rssUrl);
  } catch (err) {
    console.log(`  ❌ RSS FEED FAILED: ${err}`);
    return;
  }
  console.log(`  RSS items: ${feed.items.length}`);

  const article = feed.items.find((i) => i.link && i.title);
  if (!article) {
    console.log('  ❌ No articles with link+title in feed');
    return;
  }

  console.log(`  Testing article: ${article.title}`);
  console.log(`  URL: ${article.link}`);

  let html: string;
  try {
    html = await fetchHtml(article.link!);
  } catch (err) {
    console.log(`  ❌ HTML FETCH FAILED: ${err}`);
    return;
  }
  console.log(`  HTML length: ${html.length} chars`);

  console.log('\n  --- BODY selectors ---');
  const bodyResults = checkSelectors(html, adapter.bodySelectors, 'body');
  let anyBodyFound = false;
  for (const r of bodyResults) {
    const icon = r.found && r.textLength > 50 ? '✅' : r.found ? '⚠️' : '❌';
    if (r.found && r.textLength > 50) anyBodyFound = true;
    console.log(`  ${icon} ${r.name} — found=${r.found}, len=${r.textLength}`);
    if (r.preview) console.log(`      "${r.preview}..."`);
  }
  if (!anyBodyFound) {
    console.log('  🔍 NO BODY SELECTOR MATCHED — dumping candidate elements...');
    const $ = cheerio.load(html);
    const candidates = ['article', '[class*="article"]', '[class*="body"]', '[class*="content"]', '[class*="cikk"]', '[class*="text"]', 'main', '.entry-content', '.post-content'];
    for (const sel of candidates) {
      const el = $(sel);
      if (el.length > 0) {
        const txt = el.first().text().replace(/\s+/g, ' ').trim();
        if (txt.length > 50) {
          console.log(`      CANDIDATE: ${sel} (${el.length} matches, text=${txt.length} chars)`);
          console.log(`        "${txt.slice(0, 150)}..."`);
        }
      }
    }
  }

  console.log('\n  --- LEAD selectors ---');
  const leadResults = checkSelectors(html, adapter.leadSelectors, 'lead');
  for (const r of leadResults) {
    const icon = r.found && r.textLength > 10 ? '✅' : r.found ? '⚠️' : '❌';
    console.log(`  ${icon} ${r.name} — found=${r.found}, len=${r.textLength}`);
    if (r.preview) console.log(`      "${r.preview}..."`);
  }

  console.log('\n  --- CATEGORY selectors ---');
  const catResults = checkSelectors(html, adapter.categorySelectors, 'category');
  for (const r of catResults) {
    const icon = r.found ? '✅' : '❌';
    console.log(`  ${icon} ${r.name} — found=${r.found}, len=${r.textLength}`);
    if (r.preview) console.log(`      "${r.preview}..."`);
  }

  console.log('\n  --- OG metadata ---');
  const $ = cheerio.load(html);
  const ogImage = $('meta[property="og:image"]').attr('content');
  const ogDesc = $('meta[property="og:description"]').attr('content');
  console.log(`  og:image = ${ogImage ? '✅ ' + ogImage.slice(0, 80) : '❌ missing'}`);
  console.log(`  og:description = ${ogDesc ? '✅ (' + ogDesc.length + ' chars)' : '❌ missing'}`);
}

async function main() {
  console.log('Selector Verification Report');
  console.log(`Date: ${new Date().toISOString()}\n`);

  for (const adapter of adapters) {
    await checkAdapter(adapter);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('DONE');
}

main().catch(console.error);
