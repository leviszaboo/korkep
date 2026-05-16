import { Worker, type Job } from 'bullmq';
import { eq, or } from 'drizzle-orm';
import type { RawArticle } from '@korkep/shared';
import { truncateForEmbedding } from '@korkep/shared';
import { config } from '../config.js';
import { db, schema } from '../lib/db.js';
import { fingerprint } from '../lib/fingerprint.js';
import { embeddingBatcher } from '../processors/embedder.js';
import { assignStory } from '../processors/clusterer.js';
import { analyzeArticle } from '../processors/summarizer.js';
import { logger } from '../logger.js';

export function startProcessWorker() {
  const worker = new Worker(
    'process',
    async (job: Job<RawArticle>) => {
      const raw = job.data;

      const fp = fingerprint(raw.body ?? raw.title);

      const existing = await db
        .select({ id: schema.articles.id })
        .from(schema.articles)
        .where(or(eq(schema.articles.url, raw.url), eq(schema.articles.fingerprint, fp)))
        .limit(1);

      if (existing.length > 0) {
        logger.debug({ url: raw.url }, 'Article already exists, skipping');
        return;
      }

      const source = await db
        .select({ id: schema.sources.id })
        .from(schema.sources)
        .where(eq(schema.sources.slug, raw.sourceSlug))
        .limit(1);

      if (source.length === 0) {
        logger.warn({ sourceSlug: raw.sourceSlug }, 'Source not found');
        return;
      }

      const sourceId = source[0].id;

      // Step 1: Analyze article via LLM (structured output)
      let summary: string | null = null;
      let headline: string | null = null;
      let mainEvent: string | null = null;
      let storyIdentity: string | null = null;
      let articleType: string | null = null;
      let location: string | null = null;
      let entities: string[] | null = null;
      let topics: string[] | null = null;

      try {
        const analysis = await analyzeArticle(
          raw.title,
          raw.body ?? null,
          raw.lead ?? null,
        );
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

      // Step 2: Generate embedding with structured fields
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
        embedding = await embeddingBatcher.embed(embeddingText);
      } catch (err) {
        logger.error({ err, url: raw.url }, 'Embedding failed, storing without');
      }

      // Step 3: Assign to story cluster (skip aggregation articles)
      let storyId: number | null = null;
      if (embedding && articleType !== 'aggregation') {
        try {
          storyId = await assignStory(headline ?? raw.title, embedding, sourceId);
        } catch (err) {
          logger.error({ err, url: raw.url }, 'Clustering failed, storing without story');
        }
      }

      // Step 4: Store article
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
        publishedAt: raw.publishedAt ? new Date(raw.publishedAt) : null,
        fingerprint: fp,
        embedding,
        storyId,
      });

      logger.info(
        { url: raw.url, storyId, hasSummary: !!summary, topics },
        'Article processed and stored',
      );
    },
    {
      connection: { url: config.redis.url },
      concurrency: 15,
      lockDuration: 90_000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Process job failed');
  });

  return worker;
}
