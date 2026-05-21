export type EventRole =
  | 'announcement'
  | 'reaction'
  | 'analysis'
  | 'background'
  | 'aggregation'
  | 'event';

export interface StoryIdentityInput {
  title: string;
  summary: string | null;
  mainEvent: string | null;
  storyIdentity: string | null;
  articleType: string | null;
  location: string | null;
  entities: string[] | null;
  topics: string[] | null;
}

const REACTION_PATTERNS = [
  /\breag[aá]l/i,
  /\bb[ií]r[aá]l/i,
  /\bmegsz[oó]lalt/i,
  /\bvisszasz[oó]lt/i,
  /\bkomment[aá]lja/i,
  /\bt[aá]mogat[aá]s[aá]r[oó]l biztos/i,
  /\bfigyelmeztet[eé]s/i,
];

const ANNOUNCEMENT_PATTERNS = [
  /\bbejelent/i,
  /\bbeny[uú]jt/i,
  /\bvissza[aá]ll/i,
  /\bkinevez/i,
  /\bel[oő]l[eé]ptet/i,
  /\bv[aá]dat emel/i,
  /\bpanaszt (tesz|ny[uú]jt)/i,
  /\bmegnyit/i,
];

export function classifyEventRole(article: StoryIdentityInput): EventRole {
  const type = article.articleType;
  if (type === 'aggregation') return 'aggregation';
  if (type === 'opinion') return 'analysis';
  if (type === 'background') return 'background';

  const text = `${article.title}\n${article.storyIdentity ?? ''}\n${article.mainEvent ?? ''}`;
  if (REACTION_PATTERNS.some((pattern) => pattern.test(text))) return 'reaction';
  if (ANNOUNCEMENT_PATTERNS.some((pattern) => pattern.test(text))) return 'announcement';
  return 'event';
}

export function buildClusterEmbeddingText(article: StoryIdentityInput): string {
  const role = classifyEventRole(article);
  const lines = [
    `STORY_IDENTITY: ${article.storyIdentity?.trim() || article.mainEvent?.trim() || article.title.trim()}`,
    `EVENT_ROLE: ${role}`,
  ];

  if (article.mainEvent?.trim()) lines.push(`MAIN_EVENT: ${article.mainEvent.trim()}`);
  if (article.articleType?.trim()) lines.push(`ARTICLE_TYPE: ${article.articleType.trim()}`);
  if (article.location?.trim()) lines.push(`LOCATION: ${article.location.trim()}`);
  if (article.entities?.length) lines.push(`ENTITIES: ${article.entities.slice(0, 8).join('; ')}`);
  if (article.topics?.length) lines.push(`TOPICS: ${article.topics.slice(0, 3).join('; ')}`);
  lines.push(`TITLE: ${article.title.trim()}`);

  return lines.join('\n').slice(0, 1800);
}

function normalizedTokenSet(text: string): Set<string> {
  return new Set(text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4));
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.min(a.size, b.size);
}

function normalizeEntity(entity: string): string {
  return entity
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function areStoryInputsCompatible(
  left: StoryIdentityInput,
  right: StoryIdentityInput,
): { compatible: boolean; reason: string } {
  const leftRole = classifyEventRole(left);
  const rightRole = classifyEventRole(right);

  if (leftRole === 'aggregation' || rightRole === 'aggregation') {
    return { compatible: false, reason: 'aggregation article cannot be clustered as a concrete story' };
  }

  if ((leftRole === 'analysis' || leftRole === 'background') && rightRole !== leftRole) {
    return { compatible: false, reason: `role mismatch: ${leftRole} vs ${rightRole}` };
  }
  if ((rightRole === 'analysis' || rightRole === 'background') && leftRole !== rightRole) {
    return { compatible: false, reason: `role mismatch: ${leftRole} vs ${rightRole}` };
  }

  if (
    left.location?.trim()
    && right.location?.trim()
    && normalizeEntity(left.location) !== normalizeEntity(right.location)
  ) {
    return { compatible: false, reason: `location mismatch: ${left.location} vs ${right.location}` };
  }

  const leftText = `${left.storyIdentity ?? ''} ${left.mainEvent ?? ''}`;
  const rightText = `${right.storyIdentity ?? ''} ${right.mainEvent ?? ''}`;
  const textOverlap = overlapRatio(normalizedTokenSet(leftText), normalizedTokenSet(rightText));

  const leftEntities = new Set((left.entities ?? []).map(normalizeEntity));
  const rightEntities = new Set((right.entities ?? []).map(normalizeEntity));
  let sharedEntities = 0;
  for (const entity of leftEntities) if (rightEntities.has(entity)) sharedEntities++;

  if (textOverlap < 0.22 && sharedEntities === 0) {
    return { compatible: false, reason: 'low identity overlap and no shared entities' };
  }

  if (sharedEntities <= 1 && textOverlap < 0.34) {
    return { compatible: false, reason: 'insufficient identity overlap for weak entity match' };
  }

  return { compatible: true, reason: 'identity inputs are compatible' };
}
