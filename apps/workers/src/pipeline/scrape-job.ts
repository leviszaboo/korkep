import { inArray, count } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import pLimit from 'p-limit';
import type { RawArticle } from '@korkep/shared';
import { SOURCES } from '@korkep/shared';
import { config } from '../config.js';
import { db, pool, schema } from '../lib/db.js';
import { fingerprint } from '../lib/fingerprint.js';
import { logger } from '../logger.js';
import { queuePush, disconnectQueue, QUEUE_PROCESS } from './queue.js';
import { triggerNextJob } from './trigger.js';
import type { ArticleCandidate, BaseAdapter } from '../adapters/base.js';

import { TelexAdapter } from '../adapters/telex.js';
import { FourFourFourAdapter } from '../adapters/444.js';
import { IndexHuAdapter } from '../adapters/index-hu.js';
import { HvgAdapter } from '../adapters/hvg.js';
import { MagyarNemzetAdapter } from '../adapters/magyar-nemzet.js';
import { OrigoAdapter } from '../adapters/origo.js';
import { TwentyFourHuAdapter } from '../adapters/24hu.js';
import { MandinerAdapter } from '../adapters/mandiner.js';
import { BlikkAdapter } from '../adapters/blikk.js';
import { HangAdapter } from '../adapters/hang.js';
import { EuronewsHuAdapter } from '../adapters/euronews-hu.js';
import { MetropolAdapter } from '../adapters/metropol.js';
import { RipostAdapter } from '../adapters/ripost.js';
import { AtvAdapter } from '../adapters/atv.js';
import { PortfolioAdapter } from '../adapters/portfolio.js';
import { VgAdapter } from '../adapters/vg.js';
import { InfostartAdapter } from '../adapters/infostart.js';
import { PestiSracokAdapter } from '../adapters/pesti-sracok.js';

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

const SOURCE_TIMEOUT_MS = parseInt(process.env.SCRAPE_SOURCE_TIMEOUT_MS ?? '120000', 10);

export async function withSourceTimeout<T>(
  sourceSlug: string,
  work: Promise<T>,
  timeoutMs = SOURCE_TIMEOUT_MS,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return work;

  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Source ${sourceSlug} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function filterNewCandidatesByUrl(
  candidates: ArticleCandidate[],
  existingUrls: Set<string>,
): ArticleCandidate[] {
  return candidates.filter((candidate) => !existingUrls.has(candidate.url));
}

export async function main() {
  const startTime = Date.now();
  const initialMemory = process.memoryUsage();
  logger.info(
    {
      triggerMode: config.pipeline.triggerMode,
      concurrency: config.scrape.concurrency,
      extractConcurrency: config.scrape.extractConcurrency,
      maxArticlesPerSource: config.scrape.maxArticlesPerSource,
      memory: {
        heapUsed: Math.round(initialMemory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(initialMemory.heapTotal / 1024 / 1024),
      },
    },
    'Scrape job started',
  );

  let scraped = 0;
  let inserted = 0;
  let duplicates = 0;
  let missingSource = 0;
  let skipped = 0;
  let adapterErrors = 0;

  const newArticleIds: number[] = [];

  // Batch source ID lookup: fetch all source IDs in one query
  const sourceSlugs = SOURCES.filter((s) => s.rssUrl).map((s) => s.slug);
  const dbSources = await db
    .select({ id: schema.sources.id, slug: schema.sources.slug })
    .from(schema.sources)
    .where(inArray(schema.sources.slug, sourceSlugs));

  const sourceIdMap = new Map(dbSources.map((s) => [s.slug, s.id]));

  logger.info(
    {
      sourceSlugsToFetch: sourceSlugs.length,
      sourcesFoundInDb: dbSources.length,
      sourceIds: Array.from(sourceIdMap.entries())
        .slice(0, 5)
        .map(([slug, id]) => `${slug}:${id}`),
    },
    'Source IDs loaded from database',
  );

  // Use p-limit to control source-level concurrency
  const limit = pLimit(config.scrape.concurrency);

  await Promise.allSettled(
    SOURCES.map((source) =>
      limit(async () => {
        if (!source.rssUrl) {
          logger.debug({ sourceSlug: source.slug }, 'Source has no RSS URL, skipping');
          return;
        }

        const adapter = adapters[source.slug];
        if (!adapter) {
          logger.error({ sourceSlug: source.slug }, 'No adapter found for source');
          adapterErrors++;
          return;
        }

        const sourceId = sourceIdMap.get(source.slug);
        if (!sourceId) {
          logger.error({ sourceSlug: source.slug }, 'Source not in DB, cannot fetch');
          missingSource++;
          return;
        }

        const sourceFetchStart = Date.now();
        try {
          logger.info({ sourceSlug: source.slug }, 'Source scrape started');
          const candidates = await withSourceTimeout(
            source.slug,
            adapter.fetchCandidates(config.scrape.maxArticlesPerSource),
          );

          logger.info(
            { sourceSlug: source.slug, candidates: candidates.length },
            'Article candidates fetched from RSS',
          );

          const existingUrlRows = candidates.length > 0
            ? await db
                .select({ url: schema.articles.url })
                .from(schema.articles)
                .where(inArray(schema.articles.url, candidates.map((candidate) => candidate.url)))
            : [];

          const existingUrls = new Set(existingUrlRows.map((row) => row.url));
          const candidatesToExtract = filterNewCandidatesByUrl(candidates, existingUrls);

          duplicates += candidates.length - candidatesToExtract.length;

          logger.info(
            {
              sourceSlug: source.slug,
              candidates: candidates.length,
              existingUrls: existingUrls.size,
              candidatesToExtract: candidatesToExtract.length,
            },
            'Early URL duplicate filtering complete',
          );

          const extractLimit = pLimit(config.scrape.extractConcurrency);
          const articles = await withSourceTimeout(
            source.slug,
            Promise.all(
              candidatesToExtract.map((candidate) =>
                extractLimit(() => adapter.extractArticle(candidate)),
              ),
            ).then((results) => results.filter((article): article is RawArticle => article !== null)),
          );

          const fetchDurationMs = Date.now() - sourceFetchStart;
          const stats = adapter.getStats();

          logger.info(
            { sourceSlug: source.slug, count: articles.length, durationMs: fetchDurationMs, stats },
            'Articles fetched from adapter',
          );

          scraped += articles.length;

          // Compute fingerprints for all articles
          const articlesWithFp = articles
            .map((raw) => ({
              ...raw,
              fp: fingerprint(raw.body ?? raw.title),
            }))
            .filter((raw) => {
              // Skip articles with missing required fields or empty content
              if (!raw.url || !raw.title || !raw.fp) {
                logger.debug(
                  { source: source.slug, url: raw.url, title: raw.title?.substring(0, 50), hasFingerprint: !!raw.fp },
                  'Skipping article with missing required fields',
                );
                skipped++;
                return false;
              }
              // Verify url and title are strings (not objects from parser)
              if (typeof raw.url !== 'string' || typeof raw.title !== 'string' || typeof raw.fp !== 'string') {
                logger.debug(
                  { source: source.slug, urlType: typeof raw.url, titleType: typeof raw.title, fpType: typeof raw.fp },
                  'Skipping article with invalid field types',
                );
                skipped++;
                return false;
              }
              // Skip articles with no content (prevents null values in Drizzle insert)
              if (!raw.body && !raw.lead && !raw.category) {
                logger.debug(
                  { source: source.slug, url: raw.url, title: raw.title?.substring(0, 50) },
                  'Skipping article with no extractable content',
                );
                skipped++;
                return false;
              }
              return true;
            });

          logger.debug(
            { sourceSlug: source.slug, total: articles.length, afterFiltering: articlesWithFp.length, skipped: articles.length - articlesWithFp.length },
            'Filtered articles'
          );

          // Batch duplicate check: fetch all existing fingerprints in one query.
          const existingFps = new Set<string>();

          if (articlesWithFp.length > 0) {
            const dupCheckStart = Date.now();
            logger.debug(
              { sourceSlug: source.slug, articleCount: articlesWithFp.length },
              'Starting duplicate check',
            );

            const existing = await db
              .select({
                fingerprint: schema.articles.fingerprint,
              })
              .from(schema.articles)
              .where(inArray(schema.articles.fingerprint, articlesWithFp.map((a) => a.fp)));

            const dupCheckDurationMs = Date.now() - dupCheckStart;
            logger.debug(
              { sourceSlug: source.slug, duplicateCount: existing.length, durationMs: dupCheckDurationMs },
              'Duplicate check completed',
            );

            existing.forEach((row) => {
              existingFps.add(row.fingerprint);
            });
          }

          // Filter to only new articles
          const newArticles = articlesWithFp.filter((raw) => !existingFps.has(raw.fp));

          duplicates += articlesWithFp.length - newArticles.length;

          logger.debug(
            {
              sourceSlug: source.slug,
              filtered: articlesWithFp.length,
              duplicates: articlesWithFp.length - newArticles.length,
              newArticles: newArticles.length,
            },
            'New articles identified',
          );

          // Guard check explicitly before building values object
          if (!sourceId) {
            logger.error(
              { sourceSlug: source.slug },
              'Source ID missing unexpectedly at injection point',
            );
            return;
          }

          if (newArticles.length > 0) {
            logger.debug(
              { sourceSlug: source.slug, count: newArticles.length },
              'Building insert payload',
            );

            // Ensure we don't pass malformed records
            const insertPayload = newArticles.map((raw, idx) => {
              // Ensure publishedAt is a Date object or null, never a string
              let publishedAtValue: Date | null = null;
              if (raw.publishedAt) {
                if (typeof raw.publishedAt === 'string') {
                  const parsed = new Date(raw.publishedAt);
                  if (isNaN(parsed.getTime())) {
                    logger.warn(
                      {
                        sourceSlug: source.slug,
                        articleIdx: idx,
                        publishedAtValue: raw.publishedAt,
                      },
                      'Invalid publishedAt value, using null',
                    );
                    publishedAtValue = null;
                  } else {
                    publishedAtValue = parsed;
                  }
                } else if (raw.publishedAt instanceof Date) {
                  publishedAtValue = raw.publishedAt;
                } else {
                  logger.warn(
                    {
                      sourceSlug: source.slug,
                      articleIdx: idx,
                      publishedAtType: typeof raw.publishedAt,
                    },
                    'Unexpected publishedAt type, using null',
                  );
                  publishedAtValue = null;
                }
              }

              const payload = {
                sourceId: sourceId,
                url: raw.url ?? '',
                title: raw.title ?? '',
                body: raw.body ?? null,
                lead: raw.lead ?? null,
                category: raw.category ?? null,
                author: raw.author ?? null,
                imageUrl: raw.imageUrl ?? null,
                publishedAt: publishedAtValue,
                fingerprint: raw.fp ?? '',
              };

              // Validate payload integrity before insertion
              if (!payload.url || !payload.title || !payload.fingerprint) {
                logger.error(
                  {
                    sourceSlug: source.slug,
                    url: payload.url,
                    title: payload.title?.substring(0, 50),
                    fingerprint: payload.fingerprint,
                  },
                  'Invalid article payload detected before insert',
                );
                throw new Error(
                  `Invalid payload for article: url=${payload.url}, title=${payload.title}, fp=${payload.fingerprint}`,
                );
              }

              // Validate all string fields are actually strings
              const stringFields = ['url', 'title', 'body', 'lead', 'category', 'author', 'imageUrl', 'fingerprint'];
              for (const field of stringFields) {
                const value = payload[field as keyof typeof payload];
                if (value !== null && typeof value !== 'string') {
                  logger.error(
                    {
                      sourceSlug: source.slug,
                      articleIdx: idx,
                      field,
                      valueType: typeof value,
                      value: String(value).substring(0, 100),
                    },
                    'Invalid field type in payload',
                  );
                  throw new Error(
                    `Invalid type for ${field}: expected string or null, got ${typeof value}`,
                  );
                }
              }

              return payload;
            });

            logger.debug(
              { sourceSlug: source.slug, payloadSize: insertPayload.length },
              'Insert payload built, starting database insert',
            );

            const insertStart = Date.now();
            try {
              logger.debug(
                {
                  sourceSlug: source.slug,
                  payloadCount: insertPayload.length,
                  firstUrl: insertPayload[0]?.url,
                  firstTitle: insertPayload[0]?.title?.substring(0, 50),
                },
                'Inserting articles into database',
              );

              const results = await db
                .insert(schema.articles)
                .values(insertPayload)
                .onConflictDoNothing({ target: schema.articles.url })
                .returning({ id: schema.articles.id });

              const insertDurationMs = Date.now() - insertStart;

              logger.debug(
                {
                  sourceSlug: source.slug,
                  insertedCount: results.length,
                  resultIds: results.map((r) => r.id),
                },
                'Insert results received',
              );

              results.forEach((result) => {
                newArticleIds.push(result.id);
              });

              inserted += results.length;

              logger.info(
                {
                  source: source.slug,
                  attempted: insertPayload.length,
                  inserted: results.length,
                  conflicts: insertPayload.length - results.length,
                  durationMs: insertDurationMs,
                  sampleInsertedUrl: results.length > 0 ? 'inserted' : 'none',
                },
                'Articles inserted',
              );
            } catch (insertErr) {
              logger.error(
                {
                  sourceSlug: source.slug,
                  payloadCount: insertPayload.length,
                  err: insertErr,
                  samplePayload: insertPayload[0],
                },
                'Database insert failed',
              );
              throw insertErr;
            }
          } else {
            logger.info(
              { sourceSlug: source.slug },
              'No new articles to insert',
            );
          }
        } catch (err) {
          adapterErrors++;
          logger.error(
            {
              source: source.slug,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
              type: err instanceof Error ? err.constructor.name : typeof err,
            },
            'Source scrape failed',
          );
        }
      }),
    ),
  );

  logger.info(
    {
      scraped,
      inserted,
      duplicates,
      skipped,
      missingSource,
      adapterErrors,
      newArticleIds: newArticleIds.length,
    },
    'Scrape complete',
  );

  // Verify articles are in database
  try {
    const articleCount = await db
      .select({ count: count() })
      .from(schema.articles);

    const recentArticles = await db
      .select({ id: schema.articles.id, url: schema.articles.url, title: schema.articles.title })
      .from(schema.articles)
      .limit(5);

    logger.info(
      {
        totalArticlesInDb: articleCount[0]?.count ?? 0,
        recentArticlesCount: recentArticles.length,
        sampleArticles: recentArticles.map((a) => ({
          id: a.id,
          url: a.url.substring(0, 60),
          title: a.title?.substring(0, 50),
        })),
      },
      'Database verification after scrape',
    );
  } catch (verifyErr) {
    logger.error({ err: verifyErr }, 'Failed to verify articles in database');
  }

  if (newArticleIds.length > 0) {
    logger.info({ count: newArticleIds.length }, 'Queuing articles for processing');
    await queuePush(QUEUE_PROCESS, newArticleIds);
  } else {
    logger.warn('No articles queued for processing');
  }

  const durationMs = Date.now() - startTime;
  const finalMemory = process.memoryUsage();

  logger.info(
    {
      durationMs,
      inserted,
      memory: {
        heapUsed: Math.round(finalMemory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(finalMemory.heapTotal / 1024 / 1024),
        heapDiff: Math.round((finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024),
      },
      throughput: Math.round((inserted / durationMs) * 1000),
    },
    'Scrape job finished',
  );

  try {
    logger.debug('Triggering next job in pipeline');  
    await triggerNextJob(newArticleIds.length);
    logger.debug('Next job triggered');
  } catch (err) {
    logger.error({ err }, 'Failed to trigger next job');
  }

  try {
    logger.debug('Disconnecting queue');
    await disconnectQueue();
    logger.debug('Queue disconnected');
  } catch (err) {
    logger.error({ err }, 'Error disconnecting queue');
  }

  try {
    logger.debug('Closing database pool');
    await pool.end();
    logger.debug('Database pool closed');
  } catch (err) {
    logger.error({ err }, 'Error closing database pool');
  }

  logger.info('Scrape job cleanup complete');
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isDirectRun) {
  main()
    .then(() => {
      logger.info('Scrape job completed successfully');
      // Force exit after a short delay to ensure all logs are flushed
      setTimeout(() => {
        process.exit(0);
      }, 500);
    })
    .catch((err) => {
      logger.fatal({ err }, 'Scrape job failed');
      // Force exit after a short delay to ensure error is logged
      setTimeout(() => {
        process.exit(1);
      }, 500);
    });
}
