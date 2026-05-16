import { createHash } from 'node:crypto';

export function fingerprint(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(normalized).digest('hex');
}

const MAX_BODY_CHARS = 800;
const MIN_BODY_CHARS = 150;

const TITLE_PREFIXES = /^(Élő|ÉLŐ|Videó|VIDEÓ|Friss|FRISS|Percről percre|Exkluzív|EXKLUZÍV)\s*:\s*/;

const BOILERPLATE_PATTERNS = [
  /Borítókép:.*$/s,
  /További játékainkhoz kattintson ide!$/,
  /Cikkünket? frissítjük\.?/g,
  /Már előfizetőnk vagy\? Jelentkezz be!$/,
  /ElőfizetekMár csatlakoztál hozzánk\?.*$/s,
  /Megnézem a csomagokat Már előfizetőnk vagy\?.*$/s,
  /lájkolja a HVG Tech rovatának Facebook-oldalát\.$/,
];

function cleanTitle(title: string): string {
  return title.trim().replace(TITLE_PREFIXES, '');
}

function cleanBody(body: string): string {
  let cleaned = body.trim();
  for (const pattern of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.trim();
}

export interface EmbeddingFields {
  title: string;
  body?: string | null;
  publishedAt?: Date | string | null;
  summary?: string | null;
  lead?: string | null;
  category?: string | null;
  mainEvent?: string | null;
  location?: string | null;
  entities?: string[] | null;
  topics?: string[] | null;
}

export function truncateForEmbedding(fields: EmbeddingFields): string {
  const t = cleanTitle(fields.title);

  const parts: string[] = [];

  if (fields.publishedAt) {
    const d = typeof fields.publishedAt === 'string' ? new Date(fields.publishedAt) : fields.publishedAt;
    if (!isNaN(d.getTime())) {
      parts.push(`[${d.toISOString().slice(0, 10)}]`);
    }
  }

  if (fields.topics?.length) {
    parts.push(`[${fields.topics.join(', ')}]`);
  } else if (fields.category) {
    parts.push(`[${fields.category}]`);
  }

  parts.push(`${t}.`);

  if (fields.mainEvent) {
    parts.push(`Event: ${fields.mainEvent}`);
  }

  if (fields.location) {
    parts.push(`Location: ${fields.location}`);
  }

  if (fields.entities?.length) {
    parts.push(`Entities: ${fields.entities.join(', ')}`);
  }

  if (fields.summary && fields.summary.length >= MIN_BODY_CHARS) {
    parts.push(fields.summary);
  } else if (fields.lead && fields.lead.length >= MIN_BODY_CHARS) {
    const bodySnippet = fields.body ? ` ${cleanBody(fields.body).slice(0, MAX_BODY_CHARS - fields.lead.length)}` : '';
    parts.push(`${fields.lead}${bodySnippet}`);
  } else if (fields.body) {
    const cleaned = cleanBody(fields.body);
    if (cleaned.length >= MIN_BODY_CHARS) {
      parts.push(cleaned.slice(0, MAX_BODY_CHARS));
    }
  }

  return parts.join(' | ');
}
