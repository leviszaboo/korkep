import { sql, eq, desc, and, count } from 'drizzle-orm';
import { IMAGE_EXCLUDED_SOURCE_SLUGS, TOPIC_WEIGHTS } from '@korkep/shared';
import { db, schema } from './index.js';

export type SortMode = 'relevance' | 'latest';

const IMAGE_EXCLUDED_SOURCE_SQL = IMAGE_EXCLUDED_SOURCE_SLUGS.map((slug) => `'${slug}'`).join(',');

const storyPublicColumns = {
  id: schema.stories.id,
  title: schema.stories.title,
  summary: schema.stories.summary,
  topic: schema.stories.topic,
  topics: schema.stories.topics,
  articleCount: schema.stories.articleCount,
  sourceCount: schema.stories.sourceCount,
  relevanceScore: schema.stories.relevanceScore,
  entities: schema.stories.entities,
  firstSeenAt: schema.stories.firstSeenAt,
  updatedAt: schema.stories.updatedAt,
  createdAt: schema.stories.createdAt,
};

export async function getStories(page: number, limit: number, topic?: string, sort: SortMode = 'relevance', since?: string) {
  const offset = (page - 1) * limit;

  function buildTimeConditions(sinceValue: string) {
    const conds: ReturnType<typeof sql>[] = [];
    const now = new Date();
    let sinceDate: Date;
    let untilDate: Date | null = null;
    if (sinceValue === 'today') {
      sinceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (sinceValue === 'yesterday') {
      sinceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      untilDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (sinceValue === 'week') {
      sinceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      untilDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    } else {
      sinceDate = new Date(0);
    }
    conds.push(sql`(SELECT MAX(a.published_at) FROM articles a WHERE a.story_id = ${schema.stories.id}) >= ${sinceDate.toISOString()}`);
    if (untilDate) {
      conds.push(sql`(SELECT MAX(a.published_at) FROM articles a WHERE a.story_id = ${schema.stories.id}) < ${untilDate.toISOString()}`);
    }
    return conds;
  }

  const conditions = [];
  if (topic) conditions.push(sql`${schema.stories.topics} @> ARRAY[${topic}]::text[]`);
  if (since) conditions.push(...buildTimeConditions(since));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const latestPublishedAtExpr = sql`(SELECT MAX(a.published_at) FROM articles a WHERE a.story_id = ${schema.stories.id})`;

  const topicWeightCases = Object.entries(TOPIC_WEIGHTS)
    .map(([t, w]) => `WHEN topics[1] = '${t}' THEN ${w}`)
    .join(' ');
  const topicWeightExpr = topic
    ? sql`1.0`
    : sql.raw(`(CASE ${topicWeightCases} ELSE 0.5 END)`);

  const primaryTopicBoost = topic
    ? sql`CASE WHEN topics[1] = ${topic} THEN 5.0 ELSE 0.0 END`
    : sql`0.0`;

  const useTimeDecay = sort === 'relevance' && since !== 'week';
  const orderBy = sort === 'relevance'
    ? useTimeDecay
      ? sql`(${schema.stories.relevanceScore} * ${topicWeightExpr} + GREATEST(0, 6.0 * exp(-EXTRACT(EPOCH FROM (now() - ${schema.stories.firstSeenAt})) / 86400.0)) + ${primaryTopicBoost}) DESC`
      : sql`(${schema.stories.relevanceScore} * ${topicWeightExpr} + ${primaryTopicBoost}) DESC`
    : sql`${latestPublishedAtExpr} DESC NULLS LAST`;

  const [storiesResult, totalResult] = await Promise.all([
    db
      .select(storyPublicColumns)
      .from(schema.stories)
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(schema.stories)
      .where(where),
  ]);

  let finalStories = storiesResult;

  if (since === 'today' && storiesResult.length < 5) {
    const backfillConditions = [];
    if (topic) backfillConditions.push(sql`${schema.stories.topics} @> ARRAY[${topic}]::text[]`);
    backfillConditions.push(...buildTimeConditions('yesterday'));
    const backfillWhere = and(...backfillConditions);
    const todayIds = new Set(storiesResult.map((s) => s.id));

    const backfillResult = await db
      .select(storyPublicColumns)
      .from(schema.stories)
      .where(backfillWhere)
      .orderBy(orderBy)
      .limit(limit - storiesResult.length);

    finalStories = [...storiesResult, ...backfillResult.filter((s) => !todayIds.has(s.id))];
  }

  const storyIds = finalStories.map((s) => s.id);

  let biasMap = new Map<number, { left: number; center: number; right: number }>();
  let imageMap = new Map<number, string>();
  let sourcesMap = new Map<number, { name: string; slug: string; biasRating: string; logoUrl: string | null }[]>();
  let latestPublishedMap = new Map<number, string>();

  if (storyIds.length > 0) {
    const [biasResult, imageResult, sourcesResult, latestPublishedResult] = await Promise.all([
      db.execute<{
        story_id: number;
        left: string;
        center: string;
        right: string;
      }>(sql`
        SELECT
          a.story_id,
          COUNT(*) FILTER (WHERE s.bias_rating IN ('left', 'center-left'))::text AS "left",
          COUNT(*) FILTER (WHERE s.bias_rating = 'center')::text AS center,
          COUNT(*) FILTER (WHERE s.bias_rating IN ('right', 'center-right'))::text AS "right"
        FROM articles a
        JOIN sources s ON s.id = a.source_id
        WHERE a.story_id IN (${sql.raw(storyIds.join(','))})
        GROUP BY a.story_id
      `),
      db.execute<{ story_id: number; image_url: string }>(sql`
        SELECT DISTINCT ON (a.story_id) a.story_id, a.image_url
        FROM articles a
        JOIN sources s ON s.id = a.source_id
        WHERE a.story_id IN (${sql.raw(storyIds.join(','))})
          AND a.image_url IS NOT NULL
          AND s.slug NOT IN (${sql.raw(IMAGE_EXCLUDED_SOURCE_SQL)})
        ORDER BY a.story_id, a.published_at DESC NULLS LAST
      `),
      db.execute<{
        story_id: number;
        name: string;
        slug: string;
        bias_rating: string;
        logo_url: string | null;
      }>(sql`
        SELECT sub.story_id, s.name, s.slug, s.bias_rating, s.logo_url
        FROM (SELECT DISTINCT story_id, source_id FROM articles WHERE story_id IN (${sql.raw(storyIds.join(','))})) sub
        JOIN sources s ON s.id = sub.source_id
        ORDER BY sub.story_id, s.name
      `),
      db.execute<{ story_id: number; latest_published_at: string }>(sql`
        SELECT a.story_id, MAX(a.published_at)::text AS latest_published_at
        FROM articles a
        WHERE a.story_id IN (${sql.raw(storyIds.join(','))})
          AND a.published_at IS NOT NULL
        GROUP BY a.story_id
      `),
    ]);

    for (const row of biasResult.rows ?? []) {
      biasMap.set(row.story_id, {
        left: Number(row.left),
        center: Number(row.center),
        right: Number(row.right),
      });
    }

    for (const row of imageResult.rows ?? []) {
      imageMap.set(row.story_id, row.image_url);
    }

    for (const row of sourcesResult.rows ?? []) {
      const arr = sourcesMap.get(row.story_id) ?? [];
      arr.push({ name: row.name, slug: row.slug, biasRating: row.bias_rating, logoUrl: row.logo_url });
      sourcesMap.set(row.story_id, arr);
    }

    for (const row of latestPublishedResult.rows ?? []) {
      latestPublishedMap.set(row.story_id, row.latest_published_at);
    }
  }

  const data = finalStories.map((story) => ({
    ...story,
    imageUrl: imageMap.get(story.id) ?? null,
    sourceBias: biasMap.get(story.id) ?? { left: 0, center: 0, right: 0 },
    sources: sourcesMap.get(story.id) ?? [],
    latestPublishedAt: latestPublishedMap.get(story.id) ?? story.updatedAt,
  }));

  return {
    data,
    pagination: {
      page,
      limit,
      total: totalResult[0]?.count ?? 0,
    },
  };
}

export async function getStoryById(id: number) {
  const [story] = await db
    .select(storyPublicColumns)
    .from(schema.stories)
    .where(eq(schema.stories.id, id))
    .limit(1);

  if (!story) return null;

  const articles = await db
    .select({
      id: schema.articles.id,
      title: schema.articles.title,
      summary: schema.articles.summary,
      mainEvent: schema.articles.mainEvent,
      location: schema.articles.location,
      entities: schema.articles.entities,
      topics: schema.articles.topics,
      lead: schema.articles.lead,
      author: schema.articles.author,
      url: schema.articles.url,
      imageUrl: schema.articles.imageUrl,
      publishedAt: schema.articles.publishedAt,
      source: {
        name: schema.sources.name,
        slug: schema.sources.slug,
        biasRating: schema.sources.biasRating,
        logoUrl: schema.sources.logoUrl,
      },
    })
    .from(schema.articles)
    .innerJoin(schema.sources, eq(schema.articles.sourceId, schema.sources.id))
    .where(eq(schema.articles.storyId, id))
    .orderBy(desc(schema.articles.publishedAt));

  return { ...story, articles };
}

export async function getSources() {
  const result = await db.execute<{
    id: number;
    name: string;
    slug: string;
    url: string;
    bias_rating: string;
    logo_url: string | null;
    article_count: string;
  }>(sql`
    SELECT s.id, s.name, s.slug, s.url, s.bias_rating, s.logo_url,
           COUNT(a.id)::text AS article_count
    FROM sources s
    LEFT JOIN articles a ON a.source_id = s.id
    WHERE s.is_active = true
    GROUP BY s.id
    ORDER BY s.name
  `);

  return (result.rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    biasRating: row.bias_rating,
    logoUrl: row.logo_url,
    articleCount: Number(row.article_count),
  }));
}

export async function getRelatedStories(storyId: number, limit = 4) {
  const story = await db
    .select({ topics: schema.stories.topics, entities: schema.stories.entities })
    .from(schema.stories)
    .where(eq(schema.stories.id, storyId))
    .limit(1);

  if (!story[0]) return [];

  const { topics, entities } = story[0];

  const topicCondition = topics && topics.length > 0
    ? sql`s.topics && ARRAY[${sql.raw(topics.map(t => `'${t.replace(/'/g, "''")}'`).join(','))}]::text[]`
    : sql`false`;

  const entityCondition = entities && entities.length > 0
    ? sql`s.entities && ARRAY[${sql.raw(entities.map(e => `'${e.replace(/'/g, "''")}'`).join(','))}]::text[]`
    : sql`false`;

  const result = await db.execute<{
    id: number;
    title: string;
    summary: string | null;
    topics: string[] | null;
    article_count: number;
    source_count: number;
    relevance_score: number;
    first_seen_at: string;
    updated_at: string;
    created_at: string;
    latest_published_at: string;
    image_url: string | null;
    left_count: string;
    center_count: string;
    right_count: string;
  }>(sql`
    SELECT
      s.id, s.title, s.summary, s.topics, s.article_count, s.source_count,
      s.relevance_score, s.first_seen_at::text, s.updated_at::text, s.created_at::text,
      COALESCE((SELECT MAX(a.published_at)::text FROM articles a WHERE a.story_id = s.id), s.updated_at::text) AS latest_published_at,
      (SELECT a2.image_url FROM articles a2 JOIN sources s2 ON s2.id = a2.source_id WHERE a2.story_id = s.id AND a2.image_url IS NOT NULL AND s2.slug NOT IN (${sql.raw(IMAGE_EXCLUDED_SOURCE_SQL)}) ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS image_url,
      COALESCE((SELECT COUNT(*)::text FROM articles a JOIN sources src ON src.id = a.source_id WHERE a.story_id = s.id AND src.bias_rating IN ('left', 'center-left')), '0') AS left_count,
      COALESCE((SELECT COUNT(*)::text FROM articles a JOIN sources src ON src.id = a.source_id WHERE a.story_id = s.id AND src.bias_rating = 'center'), '0') AS center_count,
      COALESCE((SELECT COUNT(*)::text FROM articles a JOIN sources src ON src.id = a.source_id WHERE a.story_id = s.id AND src.bias_rating IN ('right', 'center-right')), '0') AS right_count
    FROM stories s
    WHERE s.id != ${storyId}
      AND (${topicCondition} OR ${entityCondition})
    ORDER BY s.updated_at DESC
    LIMIT ${limit}
  `);

  return (result.rows ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    topics: row.topics,
    articleCount: row.article_count,
    sourceCount: row.source_count,
    relevanceScore: row.relevance_score,
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    latestPublishedAt: row.latest_published_at,
    imageUrl: row.image_url,
    sourceBias: {
      left: Number(row.left_count),
      center: Number(row.center_count),
      right: Number(row.right_count),
    },
    sources: [],
  }));
}

export async function getSharedStories(slugA: string, slugB: string, limit = 50) {
  const result = await db.execute<{
    story_id: number;
    story_title: string;
    story_topics: string[] | null;
    latest_published_at: string;
    title_a: string;
    bias_a: string;
    title_b: string;
    bias_b: string;
  }>(sql`
    SELECT
      st.id AS story_id,
      st.title AS story_title,
      st.topics AS story_topics,
      COALESCE(GREATEST(a1.published_at, a2.published_at)::text, st.updated_at::text) AS latest_published_at,
      a1.title AS title_a,
      s1.bias_rating AS bias_a,
      a2.title AS title_b,
      s2.bias_rating AS bias_b
    FROM stories st
    JOIN LATERAL (
      SELECT a.title, a.published_at FROM articles a
      JOIN sources s ON s.id = a.source_id AND s.slug = ${slugA}
      WHERE a.story_id = st.id
      ORDER BY a.published_at DESC NULLS LAST LIMIT 1
    ) a1 ON true
    JOIN LATERAL (
      SELECT a.title, a.published_at FROM articles a
      JOIN sources s ON s.id = a.source_id AND s.slug = ${slugB}
      WHERE a.story_id = st.id
      ORDER BY a.published_at DESC NULLS LAST LIMIT 1
    ) a2 ON true
    JOIN sources s1 ON s1.slug = ${slugA}
    JOIN sources s2 ON s2.slug = ${slugB}
    ORDER BY GREATEST(a1.published_at, a2.published_at) DESC NULLS LAST
    LIMIT ${limit}
  `);

  return (result.rows ?? []).map((row) => ({
    storyId: row.story_id,
    storyTitle: row.story_title,
    storyTopics: row.story_topics,
    latestPublishedAt: row.latest_published_at,
    sourceA: { title: row.title_a, biasRating: row.bias_a },
    sourceB: { title: row.title_b, biasRating: row.bias_b },
  }));
}

export async function searchStories(query: string) {
  const result = await db.execute<{
    story_id: number;
    story_title: string;
    story_summary: string | null;
    story_topics: string[] | null;
    source_count: number;
    article_count: number;
    image_url: string | null;
    latest_published_at: string;
    matched_articles: string;
    relevance_score: number;
  }>(sql`
    SELECT
      a.story_id,
      st.title AS story_title,
      st.summary AS story_summary,
      st.topics AS story_topics,
      st.source_count,
      st.article_count,
      MAX(a.published_at)::text AS latest_published_at,
      (SELECT a2.image_url FROM articles a2 JOIN sources s2 ON s2.id = a2.source_id WHERE a2.story_id = a.story_id AND a2.image_url IS NOT NULL AND s2.slug NOT IN (${sql.raw(IMAGE_EXCLUDED_SOURCE_SQL)}) ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS image_url,
      COUNT(a.id)::text AS matched_articles,
      MAX(ts_rank(a.search_vector, plainto_tsquery('simple', ${query}))) AS relevance_score
    FROM articles a
    JOIN stories st ON st.id = a.story_id
    WHERE a.search_vector @@ plainto_tsquery('simple', ${query})
      AND a.story_id IS NOT NULL
    GROUP BY a.story_id, st.title, st.summary, st.topics, st.source_count, st.article_count
    ORDER BY relevance_score DESC
    LIMIT 50
  `);

  let rows = result.rows ?? [];

  if (rows.length === 0) {
    const fallback = await db.execute<{
      story_id: number;
      story_title: string;
      story_summary: string | null;
      story_topics: string[] | null;
      source_count: number;
      article_count: number;
      image_url: string | null;
      latest_published_at: string;
      matched_articles: string;
      relevance_score: number;
    }>(sql`
      SELECT
        a.story_id,
        st.title AS story_title,
        st.summary AS story_summary,
        st.topics AS story_topics,
        st.source_count,
        st.article_count,
        MAX(a.published_at)::text AS latest_published_at,
        (SELECT a2.image_url FROM articles a2 JOIN sources s2 ON s2.id = a2.source_id WHERE a2.story_id = a.story_id AND a2.image_url IS NOT NULL AND s2.slug NOT IN (${sql.raw(IMAGE_EXCLUDED_SOURCE_SQL)}) ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS image_url,
        COUNT(a.id)::text AS matched_articles,
        1.0 AS relevance_score
      FROM articles a
      JOIN stories st ON st.id = a.story_id
      WHERE (a.title ILIKE ${'%' + query + '%'} OR st.title ILIKE ${'%' + query + '%'})
        AND a.story_id IS NOT NULL
      GROUP BY a.story_id, st.title, st.summary, st.topics, st.source_count, st.article_count
      ORDER BY latest_published_at DESC NULLS LAST
      LIMIT 50
    `);
    rows = fallback.rows ?? [];
  }

  return rows.map((row) => ({
    storyId: row.story_id,
    storyTitle: row.story_title,
    storySummary: row.story_summary,
    storyTopics: row.story_topics,
    sourceCount: row.source_count,
    articleCount: row.article_count,
    imageUrl: row.image_url,
    latestPublishedAt: row.latest_published_at,
    matchedArticles: Number(row.matched_articles),
    relevanceScore: row.relevance_score,
  }));
}
