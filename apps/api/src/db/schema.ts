import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  integer,
  real,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return 'vector(1024)';
  },
  toDriver(value: number[]) {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown) {
    return String(value)
      .slice(1, -1)
      .split(',')
      .map(Number);
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const sources = pgTable('sources', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  url: text('url').notNull(),
  rssUrl: text('rss_url'),
  biasRating: text('bias_rating').notNull(),
  logoUrl: text('logo_url'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const stories = pgTable(
  'stories',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    summary: text('summary'),
    topic: text('topic'),
    topics: text('topics').array(),
    articleCount: integer('article_count').default(1).notNull(),
    sourceCount: integer('source_count').default(1).notNull(),
    relevanceScore: real('relevance_score').default(0).notNull(),
    centroidEmbedding: vector('centroid_embedding'),
    entities: text('entities').array(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_stories_updated').on(table.updatedAt),
    index('idx_stories_topic').on(table.topic),
    index('idx_stories_relevance').on(table.relevanceScore),
  ],
);

export const articles = pgTable(
  'articles',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id),
    url: text('url').notNull().unique(),
    title: text('title').notNull(),
    body: text('body'),
    lead: text('lead'),
    summary: text('summary'),
    mainEvent: text('main_event'),
    storyIdentity: text('story_identity'),
    articleType: text('article_type'),
    location: text('location'),
    entities: text('entities').array(),
    topics: text('topics').array(),
    category: text('category'),
    author: text('author'),
    imageUrl: text('image_url'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    scrapedAt: timestamp('scraped_at', { withTimezone: true }).defaultNow().notNull(),
    fingerprint: text('fingerprint').notNull(),
    embedding: vector('embedding'),
    storyId: integer('story_id').references(() => stories.id),
    searchVector: tsvector('search_vector'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_articles_source').on(table.sourceId),
    index('idx_articles_published').on(table.publishedAt),
    index('idx_articles_story').on(table.storyId),
    index('idx_articles_fingerprint').on(table.fingerprint),
  ],
);

export const llmUsageLog = pgTable(
  'llm_usage_log',
  {
    id: serial('id').primaryKey(),
    provider: text('provider').notNull(),
    mode: text('mode').notNull(),
    model: text('model').notNull(),
    operation: text('operation').notNull(),
    activity: text('activity').notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),
    calledAt: timestamp('called_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_llm_usage_log_called_at').on(table.calledAt),
    index('idx_llm_usage_log_activity').on(table.activity),
    index('idx_llm_usage_log_mode').on(table.mode),
  ],
);

export const articleDiscardLog = pgTable(
  'article_discard_log',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id').references(() => sources.id),
    sourceSlug: text('source_slug').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    category: text('category'),
    reason: text('reason').notNull(),
    ruleId: text('rule_id').notNull(),
    confidence: real('confidence').notNull(),
    stage: text('stage').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    discardedAt: timestamp('discarded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_article_discard_log_url').on(table.url),
    index('idx_article_discard_log_discarded_at').on(table.discardedAt),
    index('idx_article_discard_log_source_slug').on(table.sourceSlug),
    index('idx_article_discard_log_rule_id').on(table.ruleId),
  ],
);
