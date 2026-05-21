export type TrashStage = 'candidate' | 'extracted' | 'analysis';

export type TrashClassification =
  | { action: 'keep'; signals: string[] }
  | {
      action: 'discard';
      reason: string;
      ruleId: string;
      confidence: number;
      signals: string[];
    };

export interface TrashArticleInput {
  sourceSlug: string;
  url: string;
  title: string;
  lead?: string | null;
  body?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  stage: TrashStage;
}

const SOURCE_BOOSTS = new Set(['ripost', 'origo', 'metropol', 'blikk']);

const LOW_VALUE_TITLE_PATTERNS: Array<{ id: string; pattern: RegExp; weight: number }> = [
  { id: 'sexualized', pattern: /\b(dogos|szexi|szexizik|bikini|meztelen|falatnyi)\b/, weight: 3 },
  { id: 'celebrity', pattern: /\b(celeb|sztar|tv-sztar|enekesno|modell|influenszer|vip)\b/, weight: 2 },
  { id: 'gallery', pattern: /\b(fotok|videok|galeria|kepgaleria|kepek|foto|video)\b/, weight: 2 },
  { id: 'curiosity', pattern: /\b(lelegzetelallito|nem hiszed el|ezt latnod kell|mutatjuk|nezze meg|brutalis atalakulas)\b/, weight: 1 },
  { id: 'quiz', pattern: /\b(kviz|teszt|tudasproba|optikai illuzio)\b/, weight: 2 },
  { id: 'horoscope', pattern: /\b(horoszkop|csillagjegy)\b/, weight: 2 },
  { id: 'travel', pattern: /\b(utazas|utazo|destinations?)\b/, weight: 1 },
  { id: 'howto', pattern: /\b(recept|tippek|dugulas|vizvezetek-szerelo)\b/, weight: 1 },
];

const LOW_VALUE_URL_PATTERNS: Array<{ id: string; pattern: RegExp; weight: number }> = [
  { id: 'url-gallery', pattern: /\/(foto|fotok|video|videok|galeria|kepgaleria)(\/|-|$)/, weight: 2 },
  { id: 'url-entertainment', pattern: /\/(sztar|sztardzsusz|celeb|vip|bulvar|eletmod|szorakozas)(\/|-|$)/, weight: 2 },
  { id: 'url-lifestyle', pattern: /\/(mindekozben|ezo|huha|tippek|utazas|szorakozas|sztarvilag)(\/|-|$)/, weight: 2 },
];

const LOW_VALUE_CATEGORY_PATTERNS: Array<{ id: string; pattern: RegExp; weight: number }> = [
  {
    id: 'category-entertainment',
    pattern: /\b(hazai sztarok|nemzetkozi sztarok|sztarvilag|mindekozben|ezo|huha|tippek|vip|sztar|sztardzsusz|celeb|bulvar|eletmod|szorakozas|showbiz|utazas|kviz|horoszkop|csillagjegy)\b/,
    weight: 2,
  },
];

const STRICT_LOW_VALUE_PATTERNS: Array<{ id: string; pattern: RegExp; reason?: string }> = [
  { id: 'quiz-content', pattern: /\b(kviz|kvizjatek|tudasproba|teszteld|tesztelje tudasat|mennyit tudsz|jol szelektalsz)\b/ },
  { id: 'weather-filler', pattern: /\b(strandoido|fokozodik a hoseg|milyen idojaras var|megerkezik.*meleg|berobban a nyar)\b/ },
  { id: 'soft-curiosity', pattern: /\b(albino bivaly|bogarra vadaszo rokakolyok|samu.*elefant|ave mariat|johnny depp|kozso|bochkor)\b/ },
  { id: 'sexualized-sport-celebrity', pattern: /\b(jakabos.*bikini|szettart labakkal|aprocska bikiniben)\b/ },
];

const PUBLIC_INTEREST_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'politics', pattern: /\b(kormany|miniszter|kepviselo|parlament|orszaggyules|fidesz|tisza|dk|momentum|part|ellenzek|polgarmester|valasztas|onkormanyzat)\b/ },
  { id: 'institutions', pattern: /\b(rendorseg|ugyeszseg|birosag|nav|mnb|allam|hatosag|korhaz|iskola|egyetem)\b/ },
  { id: 'crime-courts', pattern: /\b(nyomozas|vad|per|itelet|korrupcio|csalas|gyilkossag|letartoztatas|rendorsegi akcio)\b/ },
  { id: 'economy', pattern: /\b(gazdasag|ado|inflacio|forint|energia|munkaber|ceg|vallalat|beruhazas|koltsegvetes)\b/ },
  { id: 'foreign-war', pattern: /\b(haboru|ukrajna|oroszorszag|izrael|nato|eu|szankcio|diplomacia|migracio)\b/ },
  { id: 'public-services', pattern: /\b(egeszsegugy|oktatas|kozlekedes|vasut|mav|bkk|infrastruktura|jarat)\b/ },
  { id: 'emergency', pattern: /\b(baleset|katasztrofa|tuz|arviz|riasztas|mentok|idojaras)\b/ },
  { id: 'public-category', pattern: /\b(belfold|kulfold|gazdasag|politika|kozelet|aktualis|itthon)\b/ },
];

export function classifyTrashArticle(input: TrashArticleInput): TrashClassification {
  const title = normalize(input.title);
  const url = normalize(input.url);
  const category = normalize(input.category ?? '');
  const lead = normalize(input.lead ?? '');
  const body = normalize(input.body ?? '');
  const combinedPublicText = [title, category, lead, body.slice(0, 500)].join(' ');
  const combinedLowValueText = [title, category, url].join(' ');

  const strictSignals = STRICT_LOW_VALUE_PATTERNS
    .filter((rule) => rule.pattern.test(combinedLowValueText))
    .map((rule) => rule.id);
  if (strictSignals.length > 0) {
    return {
      action: 'discard',
      reason: 'Low-value quiz, weather filler, celebrity, or curiosity item',
      ruleId: 'strict-low-value',
      confidence: 0.9,
      signals: strictSignals,
    };
  }

  const publicSignals = collectPublicInterestSignals(combinedPublicText);
  if (publicSignals.length > 0) {
    return { action: 'keep', signals: publicSignals };
  }

  const signals: string[] = [];
  let score = 0;

  for (const rule of LOW_VALUE_TITLE_PATTERNS) {
    if (rule.pattern.test(title)) {
      signals.push(rule.id);
      score += rule.weight;
    }
  }

  for (const rule of LOW_VALUE_URL_PATTERNS) {
    if (rule.pattern.test(url)) {
      signals.push(rule.id);
      score += rule.weight;
    }
  }

  for (const rule of LOW_VALUE_CATEGORY_PATTERNS) {
    if (rule.pattern.test(category)) {
      signals.push(rule.id);
      score += rule.weight;
    }
  }

  const contentLength = lead.length + body.length;
  if (input.stage !== 'candidate' && contentLength > 0 && contentLength < 160 && /\b(foto|video|galeria|kepek)\b/.test([title, lead, body].join(' '))) {
    signals.push('thin-media-content');
    score += 2;
  }

  if (score > 0 && SOURCE_BOOSTS.has(input.sourceSlug)) {
    signals.push('source-boost');
    score += 1;
  }

  if (score >= 3) {
    return {
      action: 'discard',
      reason: 'Low-value celebrity, gallery, video, or entertainment item without public-interest signals',
      ruleId: 'low-value-media',
      confidence: Math.min(0.98, 0.55 + score * 0.08),
      signals,
    };
  }

  return { action: 'keep', signals };
}

function collectPublicInterestSignals(text: string): string[] {
  const signals: string[] = [];
  for (const rule of PUBLIC_INTEREST_PATTERNS) {
    if (rule.pattern.test(text)) signals.push(rule.id);
  }
  return signals;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('hu-HU')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[őŐ]/g, 'o')
    .replace(/[űŰ]/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}
