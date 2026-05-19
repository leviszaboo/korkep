import { eq, or } from 'drizzle-orm';
import type { RawArticle } from '@korkep/shared';
import { SOURCES, truncateForEmbedding } from '@korkep/shared';
import { config } from './config.js';
import { db, pool, schema } from './lib/db.js';
import { fingerprint } from './lib/fingerprint.js';
import { embeddingBatcher } from './processors/embedder.js';
import { assignStory } from './processors/clusterer.js';
import { analyzeArticle } from './processors/summarizer.js';
import { logger } from './logger.js';
import type { BaseAdapter } from './adapters/base.js';

import { TelexAdapter } from './adapters/telex.js';
import { FourFourFourAdapter } from './adapters/444.js';
import { IndexHuAdapter } from './adapters/index-hu.js';
import { HvgAdapter } from './adapters/hvg.js';
import { MagyarNemzetAdapter } from './adapters/magyar-nemzet.js';
import { OrigoAdapter } from './adapters/origo.js';
import { TwentyFourHuAdapter } from './adapters/24hu.js';
import { MandinerAdapter } from './adapters/mandiner.js';
import { BlikkAdapter } from './adapters/blikk.js';
import { HangAdapter } from './adapters/hang.js';
import { EuronewsHuAdapter } from './adapters/euronews-hu.js';
import { MetropolAdapter } from './adapters/metropol.js';
import { RipostAdapter } from './adapters/ripost.js';
import { AtvAdapter } from './adapters/atv.js';
import { PortfolioAdapter } from './adapters/portfolio.js';
import { VgAdapter } from './adapters/vg.js';
import { InfostartAdapter } from './adapters/infostart.js';
import { PestiSracokAdapter } from './adapters/pesti-sracok.js';

const adapters: Record<string, BaseAdapter> = {
  telex: new TelexAdapter(),
  '444': new FourFourFourAdapter(),
  index: new IndexHuAdapter(),
  hvg: new HvgAdapter(),
  'magyar-nemzet': new MagyarNemzetAdapter(),
  origo: new OrigoAdapter(),
  '24hu': new TwentyFourHuAdapter(),
  mandiner: new MandinerAdapter(),
  blikk: new BlikkAdapter(),
  hang: new HangAdapter(),
  'euronews-hu': new EuronewsHuAdapter(),
  metropol: new MetropolAdapter(),
  ripost: new RipostAdapter(),
  atv: new AtvAdapter(),
  portfolio: new PortfolioAdapter(),
  vg: new VgAdapter(),
  infostart: new InfostartAdapter(),
  'pesti-sracok': new PestiSracokAdapter(),
};

interface QueuedArticle {
  raw: RawArticle;
  sourceId: number;
  fp: string;
}

async function processArticle(item: QueuedArticle): Promise<'processed' | 'error'> {
  const { raw, sourceId, fp } = item;
  try {
    let summary: string | null = null;
    let headline: string | null = null;
    let mainEvent: string | null = null;
    let storyIdentity: string | null = null;
    let articleType: string | null = null;
    let location: string | null = null;
    let entities: string[] | null = null;
    let topics: string[] | null = null;

    try {
      const analysis = await analyzeArticle(raw.title, raw.body ?? null, raw.lead ?? null, 'scrape_summarize');
      if (analysis) {
        summary = analysis.summary;
        headline = analysis.headline;
        mainEvent = analysis.mainEvent;
        storyIdentity = analysis.storyIdentity;
        articleType = analysis.articleType;
        location = analysis.location;
        entities = analysis.entities.length > 0 ? analysis.entities : null;
        topics = analysis.topics.length > 0 ? analysis.topics : null;
      }
    } catch (err) {
      logger.error({ err, url: raw.url }, 'Article analysis failed, continuing without');
    }

    const embeddingText = truncateForEmbedding({
      title: raw.title,
      body: raw.body,
      publishedAt: raw.publishedAt,
      summary,
      lead: raw.lead,
      category: raw.category,
      mainEvent,
      storyIdentity,
      articleType: articleType as any,
      location,
      entities,
      topics,
    });

    let embedding: number[] | null = null;
    try {
      embedding = await embeddingBatcher.embed(embeddingText, 'scrape_embed');
    } catch (err) {
      logger.error({ err, url: raw.url }, 'Embedding failed, storing without');
    }

    let storyId: number | null = null;
    if (embedding && articleType !== 'aggregation') {
      try {
        storyId = await assignStory(headline ?? raw.title, embedding, sourceId, entities);
      } catch (err) {
        logger.error({ err, url: raw.url }, 'Clustering failed, storing without story');
      }
    }

    await db.insert(schema.articles).values({
      sourceId,
      url: raw.url,
      title: raw.title,
      body: raw.body ?? null,
      lead: raw.lead ?? null,
      summary,
      mainEvent,
      storyIdentity,
      articleType,
      location,
      entities,
      topics,
      category: raw.category ?? null,
      author: raw.author ?? null,
      imageUrl: raw.imageUrl ?? null,
      publishedAt: raw.publishedAt ?? null,
      fingerprint: fp,
      embedding,
      storyId,
    }).onConflictDoNothing({ target: schema.articles.url });

    logger.info({ url: raw.url, storyId, hasSummary: !!summary, topics }, 'Article processed');
    return 'processed';
  } catch (err) {
    logger.error({ url: raw.url, err }, 'Failed to process article');
    return 'error';
  }
}

async function main() {
  const startTime = Date.now();
  const concurrency = config.scrape.llmConcurrency;
  logger.info({ concurrency }, 'Cloud scrape job started');
  let scraped = 0;
  let processed = 0;
  let skipped = 0;

  const queue: QueuedArticle[] = [];

  // Fetch all sources concurrently
  await Promise.all(
    SOURCES.map(async (source) => {
      if (!source.rssUrl) return;
      const adapter = adapters[source.slug];
      if (!adapter) return;

      try {
        const articles = await adapter.fetchArticles();
        scraped += articles.length;

        const dbSource = await db
          .select({ id: schema.sources.id })
          .from(schema.sources)
          .where(eq(schema.sources.slug, source.slug))
          .limit(1);

        if (dbSource.length === 0) {
          logger.warn({ sourceSlug: source.slug }, 'Source not in DB, skipping');
          return;
        }

        const sourceId = dbSource[0].id;

        for (const raw of articles) {
          const fp = fingerprint(raw.body ?? raw.title);

          const existing = await db
            .select({ id: schema.articles.id })
            .from(schema.articles)
            .where(or(eq(schema.articles.url, raw.url), eq(schema.articles.fingerprint, fp)))
            .limit(1);

          if (existing.length > 0) {
            skipped++;
            continue;
          }

          queue.push({ raw, sourceId, fp });
        }

        logger.info({ source: source.slug, articles: articles.length }, 'Source done');
      } catch (err) {
        logger.error({ source: source.slug, err }, 'Source scrape failed, continuing');
      }
    })
  );

  logger.info({ queued: queue.length, skipped }, 'Scrape complete, processing articles');

  // Process with bounded concurrency
  let active = 0;
  let idx = 0;
  await new Promise<void>((resolve) => {
    if (queue.length === 0) { resolve(); return; }

    function next() {
      while (active < concurrency && idx < queue.length) {
        const item = queue[idx++];
        active++;
        processArticle(item).then((result) => {
          if (result === 'processed') processed++;
          active--;
          if (idx >= queue.length && active === 0) {
            resolve();
          } else {
            next();
          }
        });
      }
    }
    next();
  });

  const durationMs = Date.now() - startTime;
  await pool.end();
  logger.info({ durationMs, scraped, processed, skipped }, 'Cloud scrape job finished');
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, 'Cloud scrape failed');
  process.exit(1);
});
