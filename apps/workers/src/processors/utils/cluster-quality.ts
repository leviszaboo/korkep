export interface QualityArticle {
  id?: number;
  title: string;
  summary?: string | null;
  mainEvent?: string | null;
  storyIdentity?: string | null;
  articleType?: string | null;
  location?: string | null;
  entities?: string[] | null;
  topics?: string[] | null;
  embedding?: number[] | null;
}

export interface StoryMetadata {
  title: string;
  entities?: string[] | null;
  topics?: string[] | null;
}

export const RECLUSTER_DECISION_PROMPT_VERSION = 'storytitle-v2';

const REACTION_OR_ANALYSIS = new Set(['opinion', 'background', 'reaction', 'analysis']);

export function significantTokens(text: string | null | undefined): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );
}

export function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  const union = new Set([...a, ...b]).size;
  return union > 0 ? shared / union : 0;
}

export function entityOverlap(a: string[] | null | undefined, b: string[] | null | undefined): number {
  const left = normalizeList(a);
  const right = normalizeList(b);
  if (left.length === 0 || right.length === 0) return 0;
  let shared = 0;
  for (const entity of left) if (right.includes(entity)) shared++;
  const union = new Set([...left, ...right]).size;
  return union > 0 ? shared / union : 0;
}

export function countSharedEntities(a: string[] | null | undefined, b: string[] | null | undefined): number {
  const left = new Set(normalizeList(a));
  const right = new Set(normalizeList(b));
  let shared = 0;
  for (const entity of left) if (right.has(entity)) shared++;
  return shared;
}

export function articleIdentityText(article: QualityArticle): string {
  return [
    article.storyIdentity,
    article.mainEvent,
    article.title,
  ].filter(Boolean).join(' ');
}

export function metadataSuspicionScore(
  article: QualityArticle,
  target: StoryMetadata | QualityArticle[],
): { suspicious: boolean; reason: string; entityScore: number; tokenScore: number; sharedEntities: number } {
  const targetMetadata = Array.isArray(target) ? aggregateStoryMetadata(target) : target;
  const entityScore = entityOverlap(article.entities, targetMetadata.entities);
  const sharedEntities = countSharedEntities(article.entities, targetMetadata.entities);
  const articleTokens = significantTokens(articleIdentityText(article));
  const targetTokens = significantTokens(targetMetadata.title);
  const tokenScore = tokenOverlap(articleTokens, targetTokens);

  const role = article.articleType ?? 'event';
  const roleNeedsStrongerEvidence = REACTION_OR_ANALYSIS.has(role);

  if (roleNeedsStrongerEvidence && (sharedEntities < 1 || tokenScore < 0.18)) {
    return {
      suspicious: true,
      reason: `${role} article lacks enough concrete overlap`,
      entityScore,
      tokenScore,
      sharedEntities,
    };
  }

  if (sharedEntities === 0 && tokenScore < 0.14) {
    return {
      suspicious: true,
      reason: 'no shared entities and weak identity/title token overlap',
      entityScore,
      tokenScore,
      sharedEntities,
    };
  }

  return { suspicious: false, reason: 'metadata compatible', entityScore, tokenScore, sharedEntities };
}

export function clusterMetadataLooksSuspicious(articles: QualityArticle[]): { suspicious: boolean; reason: string } {
  if (articles.length < 2) return { suspicious: false, reason: 'single article' };
  const suspicious = articles
    .map((article, index) => {
      const others = articles.filter((_, otherIndex) => otherIndex !== index);
      return { article, score: metadataSuspicionScore(article, aggregateStoryMetadata(others)) };
    })
    .filter(({ score }) => score.suspicious);

  if (suspicious.length === 0) return { suspicious: false, reason: 'metadata compatible' };
  if (suspicious.length === articles.length && articles.length <= 2) return { suspicious: false, reason: 'insufficient cluster metadata' };

  return {
    suspicious: true,
    reason: suspicious.map(({ article, score }) => `#${article.id ?? '?'} ${score.reason}`).join('; '),
  };
}

export function shouldAllowHighSimilarityAssignment(input: {
  rawSimilarity: number;
  articleCount: number;
  articleType?: string | null;
  entityScore: number;
  tokenScore: number;
  sharedEntities: number;
}): boolean {
  const role = input.articleType ?? 'event';
  if (REACTION_OR_ANALYSIS.has(role)) {
    return input.rawSimilarity >= 0.94 && input.sharedEntities >= 1 && input.tokenScore >= 0.18;
  }

  if (input.rawSimilarity >= 0.94) {
    return input.sharedEntities >= 1 || input.entityScore >= 0.15 || input.tokenScore >= 0.10;
  }

  if (input.rawSimilarity >= 0.90) {
    return input.sharedEntities >= 1 && (input.entityScore >= 0.25 || input.tokenScore >= 0.20);
  }

  return false;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

export function findEmbeddingOutliers(
  articles: QualityArticle[],
  centroid: number[],
): Array<{ article: QualityArticle; centroidSimilarity: number; maxMemberSimilarity: number; reason: string }> {
  if (articles.length < 3 || centroid.length === 0) return [];
  const withEmbeddings = articles.filter((article) => article.embedding && article.embedding.length === centroid.length);
  if (withEmbeddings.length < 3) return [];

  return withEmbeddings
    .map((article) => {
      const embedding = article.embedding!;
      const centroidSimilarity = cosineSimilarity(embedding, centroid);
      const maxMemberSimilarity = Math.max(
        0,
        ...withEmbeddings
          .filter((other) => other !== article)
          .map((other) => cosineSimilarity(embedding, other.embedding!)),
      );
      return {
        article,
        centroidSimilarity,
        maxMemberSimilarity,
        reason: `centroid=${centroidSimilarity.toFixed(3)}, nearest=${maxMemberSimilarity.toFixed(3)}`,
      };
    })
    .filter(({ centroidSimilarity, maxMemberSimilarity }) =>
      centroidSimilarity < 0.80 || maxMemberSimilarity < 0.82,
    );
}

function aggregateStoryMetadata(articles: QualityArticle[]): StoryMetadata {
  return {
    title: articles.map(articleIdentityText).join(' '),
    entities: articles.flatMap((article) => article.entities ?? []),
    topics: articles.flatMap((article) => article.topics ?? []),
  };
}

function normalizeList(values: string[] | null | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.toLowerCase().trim()).filter(Boolean))];
}
