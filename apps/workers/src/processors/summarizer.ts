import type { ArticleAnalysis } from '@korkep/shared';
import { TOPICS } from '@korkep/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { type LlmActivity } from '../lib/llm-usage.js';
import { callChat, callOpenRouterChat, type ProviderConfig } from '../pipeline/provider.js';

const MAX_INPUT_CHARS = 2000;

const TOPICS_LIST = TOPICS.join(', ');

const SYSTEM_PROMPT = `Egy magyar hírösszefoglaló és -elemző rendszer vagy. A feladatod a cikk strukturált elemzése KLASZTEREZÉS céljából.

Ha a cikk nyilvánvalóan nem hírértékű trash tartalom, válaszolj pontosan \`0\` karakterrel, semmilyen más szöveg nélkül.
Ezt CSAK tiszta celeb/sztár/bulvár, szexualizált életmód, képgaléria, fotó- vagy videógyűjtemény, illetve média-wrapper cikkekre használd, amelyekben nincs érdemi közérdekű esemény.
NE válaszolj \`0\`-val, ha a cikk közérdekű vagy közéleti témát érint, például politika, képviselő, kormány, választás, rendőrség, bíróság, gazdaság, háború, külügy, egészségügy, oktatás, közlekedés, baleset vagy katasztrófa, még akkor sem, ha a cím szenzációhajhász, pártos vagy clickbait.

Válaszolj KIZÁRÓLAG az alábbi JSON formátumban, semmilyen más szöveget ne írj:
{
  "summary": "2-3 mondatos tömör, tényszerű, semleges összefoglaló (max 150 szó)",
  "headline": "Semleges, forrásfüggetlen főcím (max 15 szó)",
  "mainEvent": "Egy mondatban: mi történt / miről szól a cikk",
  "storyIdentity": "Egy mondat, ami EGYÉRTELMŰEN azonosítja ezt a konkrét történetet (lásd szabályok lent)",
  "articleType": "event | aggregation | opinion | background",
  "location": "Helyszín (város/ország/régió) vagy null ha nem releváns",
  "entities": ["Legfontosabb személyek, szervezetek, intézmények (max 5)"],
  "topics": ["Témakörök az alábbi listából (1-2): ${TOPICS_LIST}"]
}

SZABÁLYOK a storyIdentity mezőhöz:
- Célja: két cikk CSAK AKKOR tartozik egy story-ba, ha a storyIdentity-jük lényegében ugyanazt mondja
- Fogalmazd meg a KONKRÉT cselekvést/eseményt/döntést, ne csak a helyszínt vagy szereplőket
- Példa: "Magyar Péter kordont bontott tiltakozásképpen a Karmelita előtt" vs "A kormány hétvégére megnyitja a Karmelita épületét látogatóknak" — ezek KÉT KÜLÖNBÖZŐ story
- Példa: "Orbán beszédet mondott a parlamentben a költségvetésről" vs "Orbán találkozott Zelenszkijjel Kijevben" — ezek KÉT KÜLÖNBÖZŐ story
- Ha a cikk több különálló eseményt foglal össze (napi összefoglaló, percről percre), az articleType legyen "aggregation"

SZABÁLYOK az entities mezőhöz:
- Az entities mezőben kanonikus névalakokat adj meg, ne a cikkben látott felszíni említéseket
- Személyeknél teljes nevet használj, ha a cikkből kikövetkeztethető: "Magyar Péter", ne "Magyar P."
- Ne írj szerep- vagy tisztségmegjelölést zárójelben a személy nevéhez: "Magyar Péter", ne "Magyar Péter (miniszterelnök-jelölt)"
- Titulusokat, foglalkozásokat és leíró szerepeket ne olvassz be a névbe; ezek maradjanak a summary/mainEvent mezőben, ha fontosak
- Szervezeteknél stabil közismert vagy hivatalos nevet használj: "Tisza Párt", "Fidesz", "Nemzeti Adó- és Vámhivatal"
- Rövidítést csak akkor használj önálló entitásként, ha ez a közismert elsődleges név; különben a teljes nevet add vissza zárójeles rövidítés nélkül
- Ha több névváltozat ugyanarra az entitásra utal, a legteljesebb magyar kanonikus alakot add vissza
- Legfeljebb 5 legfontosabb személyt, szervezetet vagy intézményt adj vissza

articleType értékek:
- "event": egy konkrét eseményről/hírről szól
- "aggregation": több eseményt összefoglal (napi összefoglaló, hírfolyam, percről percre, élő közvetítés)
- "opinion": vélemény, publicisztika, szerkesztőségi álláspont
- "background": háttérelemzés, magyarázó cikk, amely nem egy konkrét új eseményről szól

A topics mező KIZÁRÓLAG az alábbi értékeket tartalmazhatja: ${TOPICS_LIST}`;

function buildUserPrompt(title: string, body: string | null, lead: string | null): string {
  const parts: string[] = [`Cím: ${title}`];
  if (lead) parts.push(`Lead: ${lead}`);
  if (body) {
    const truncated = body.slice(0, MAX_INPUT_CHARS);
    parts.push(`Szöveg: ${truncated}`);
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

const VALID_TOPICS = new Set<string>(TOPICS);
const VALID_ARTICLE_TYPES = new Set(['event', 'aggregation', 'opinion', 'background']);

export function parseAnalysisResponse(raw: string): ArticleAnalysis | null {
  const result = parseAnalysisResult(raw);
  return result.status === 'analyzed' ? result.analysis : null;
}

export type AnalysisParseResult =
  | { status: 'analyzed'; analysis: ArticleAnalysis }
  | { status: 'trash' };

export function parseAnalysisResult(raw: string): AnalysisParseResult {
  if (raw.trim() === '0') {
    return { status: 'trash' };
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in response');
  }
  const parsed = JSON.parse(jsonMatch[0]);

  if (!parsed.summary || !parsed.headline || !parsed.mainEvent) {
    throw new Error('Missing required fields in response');
  }

  const entities = Array.isArray(parsed.entities)
    ? parsed.entities.map(String).slice(0, 5)
    : [];

  const topics = Array.isArray(parsed.topics)
    ? parsed.topics.map(String).filter((t: string) => VALID_TOPICS.has(t)).slice(0, 3)
    : [];

  const articleType = VALID_ARTICLE_TYPES.has(parsed.articleType)
    ? (parsed.articleType as ArticleAnalysis['articleType'])
    : 'event';

  return {
    status: 'analyzed',
    analysis: {
      summary: String(parsed.summary).trim(),
      headline: String(parsed.headline).trim(),
      mainEvent: String(parsed.mainEvent).trim(),
      storyIdentity: parsed.storyIdentity ? String(parsed.storyIdentity).trim() : String(parsed.mainEvent).trim(),
      articleType,
      location: parsed.location ? String(parsed.location).trim() : null,
      entities,
      topics,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function analyzeArticle(
  title: string,
  body: string | null,
  lead: string | null,
  activity: LlmActivity,
  providerOverride?: ProviderConfig,
): Promise<ArticleAnalysis | null> {
  const contentLength = (lead?.length ?? 0) + (body?.length ?? 0);
  if (contentLength < 50) {
    logger.info({ title }, 'Article too short to analyze, skipping');
    return null;
  }

  try {
    const userPrompt = buildUserPrompt(title, body, lead);
    const providerConfig = providerOverride ?? {
      provider: config.llm.provider,
      model: config.llm.model,
    };
    logger.info({ title, contentLength }, 'Analyzing article via LLM');

    const raw = await callChat(providerConfig, SYSTEM_PROMPT, userPrompt, true, activity);
    return parseAnalysisResponse(raw);
  } catch (err) {
    logger.error({ err, title }, 'Article analysis failed');
    return null;
  }
}

export type ArticleAnalysisResult =
  | { status: 'analyzed'; analysis: ArticleAnalysis }
  | { status: 'trash' }
  | { status: 'failed' };

export async function analyzeArticleDetailed(
  title: string,
  body: string | null,
  lead: string | null,
  activity: LlmActivity,
  providerOverride?: ProviderConfig,
): Promise<ArticleAnalysisResult> {
  const contentLength = (lead?.length ?? 0) + (body?.length ?? 0);
  if (contentLength < 50) {
    logger.info({ title }, 'Article too short to analyze, skipping');
    return { status: 'failed' };
  }

  try {
    const userPrompt = buildUserPrompt(title, body, lead);
    const providerConfig = providerOverride ?? {
      provider: config.llm.provider,
      model: config.llm.model,
    };
    logger.info({ title, contentLength }, 'Analyzing article via LLM');

    const raw = await callChat(providerConfig, SYSTEM_PROMPT, userPrompt, true, activity);
    return parseAnalysisResult(raw);
  } catch (err) {
    logger.error({ err, title }, 'Article analysis failed');
    return { status: 'failed' };
  }
}

export async function analyzeArticleViaOpenRouter(
  title: string,
  body: string | null,
  lead: string | null,
  activity: LlmActivity,
): Promise<ArticleAnalysis | null> {
  const contentLength = (lead?.length ?? 0) + (body?.length ?? 0);
  if (contentLength < 50) {
    logger.debug({ title }, 'Article too short to analyze, skipping');
    return null;
  }

  try {
    const userPrompt = buildUserPrompt(title, body, lead);
    const raw = await callOpenRouterChat(
      SYSTEM_PROMPT,
      userPrompt,
      true,
      config.llm.model,
      activity,
    );
    return parseAnalysisResponse(raw);
  } catch (err) {
    logger.error({ err, title }, 'Article analysis failed (OpenRouter)');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Story title / summary generation
// ---------------------------------------------------------------------------

export type StoryTitleResult =
  | { coherent: true; title: string; summary: string | null }
  | { coherent: false; groups: number[][] };

export async function generateStoryTitleAndSummary(
  articles: { id: number; title: string; summary: string | null }[],
  activity: LlmActivity,
  providerOverride?: ProviderConfig,
  existingStory?: { title: string; summary: string | null } | null,
): Promise<StoryTitleResult | null> {
  if (articles.length === 0) return null;
  if (articles.length === 1) return null;

  const articleList = articles.map((a, i) => {
    const summary = a.summary ?? a.title;
    return `${i + 1}. [${a.title}] ${summary}`;
  }).join('\n');

  const prompt = `Az alábbi magyar hírforrásokból származó cikkeket egy klaszterbe soroltuk, mert hasonlóak.
Döntsd el, hogy VALÓBAN ugyanarról a KONKRÉT történetről/eseményről szólnak-e.

FONTOS: "ugyanaz a téma" NEM jelenti, hogy "ugyanaz a történet"!
- Az esemény/cselekvés és az arra adott reakció KÜLÖNBÖZŐ történet: pl. "Scherer Péter meghalt" vs "Scherer Péter osztálytársai reagálnak a halálhírre"
- Egy hatósági/politikai esemény és egy arról szóló vélemény vagy kommentár KÜLÖNBÖZŐ történet: pl. "A rendőrség nyomoz a BYD-ügyben" vs "Gajdos László kifejti a véleményét a BYD-ügyről"
- Közös politikai kontextus, szereplő vagy ügy önmagában nem elég; a KONKRÉT cselekvésnek/eseménynek/döntésnek is ugyanannak kell lennie
- Különböző idős emberek elleni csalások = KÜLÖNBÖZŐ történetek, még ha mindegyik "idős ember + csalás"
- Különböző celebekről szóló interjúk = KÜLÖNBÖZŐ történetek, még ha mindegyik "celeb + magánélet"
- Különböző közlekedési balesetek = KÜLÖNBÖZŐ történetek, még ha mindegyik "baleset + autópálya"
- Különböző katonai műveletek = KÜLÖNBÖZŐ történetek, még ha mindegyik "Közel-Kelet + hadsereg"
- Különböző környezeti/társadalmi problémák = KÜLÖNBÖZŐ történetek, még ha mindegyik "válság + klíma"
Csak akkor koherens, ha a cikkek UGYANAZT az egy konkrét eseményt/döntést/történést írják le más-más forrásból.

Ha IGEN (koherens klaszter):
- Írj egy semleges, de konkrét főcímet (max 15 szó)
- Ha van meglévő story-cím és a klaszter továbbra sem igényel szétválasztást, valamint a meglévő cím pontosan és semlegesen leírja ugyanazt a konkrét történetet, válaszolj pontosan \`1\` karakterrel, semmilyen más szöveg nélkül
- A főcím nevezze meg a központi szereplőt, ha az esemény megértéséhez fontos, akkor is, ha csak egyes források emelik ki
- A főcím tartalmazzon konkrét cselekvést, döntést vagy eseményt, valamint a lényegi tárgyat vagy következményt
- Kerüld a homályos ernyőcímeket, ha a konkrét történet megnevezhető: ne "Politikai vita", "Ügy fejleményei", "Közlekedési helyzet"
- Ne használj értékelő vagy pártos keretezést; a források állításait semleges igékkel foglald össze
- Példa: "Magyar Péter Donald Tuskkal tárgyalt Varsóban", ne "Politikai egyeztetés Lengyelországban"
- Példa: "A rendőrség nyomoz a szegedi BYD-beruházás földlerakása miatt", ne "BYD-ügy fejleményei"
- Írj egy 2-3 mondatos semleges összefoglalót, amely szintetizálja a különböző források információit
- FONTOS: Nyelvtanilag hibátlan, helyes magyar nyelven fogalmazz

Ha NEM (a cikkek különböző történetekről szólnak):
- Oszd csoportokra a cikkeket úgy, hogy minden csoport egy-egy önálló történetet képviseljen
- Használd a cikkek sorszámát a csoportosításhoz
- Ha egy cikk egyedül áll (nem tartozik másikhoz), tedd egyedül egy csoportba, pl. [[1], [2, 3]]

Válaszolj KIZÁRÓLAG az alábbi formátumok egyikében:
Meglévő cím megtartható: 1
Koherens: {"coherent": true, "title": "Főcím", "summary": "Összefoglaló"}
Inkoherens: {"coherent": false, "groups": [[1, 3], [2, 4]]}

${existingStory ? `Meglévő story-cím, ha továbbra is pontos: ${existingStory.title}\n\n` : 'NINCS_MEGLÉVŐ_STORY_CÍM\n\n'}
Cikkek:
${articleList}`;

  try {
    const storySystemPrompt = `Egy magyar hírösszefoglaló rendszer vagy. Klaszter-koherenciát bírálsz el konkrét cselekvés/esemény/döntés alapján.

Példák:
- "Scherer Péter meghalt" és "Scherer Péter osztálytársai reagálnak a halálhírre" KÜLÖNBÖZŐ történetek.
- "A rendőrség nyomoz a BYD-ügyben" és "Gajdos László kifejti a véleményét a BYD-ügyről" KÜLÖNBÖZŐ történetek.
- Azonos politikai ügy, szereplő vagy tág kontextus nem elég; ugyanannak a konkrét történésnek kell lennie.

Válaszolj KIZÁRÓLAG a kért formátumok egyikében, semmilyen más szöveget ne írj.`;
    const providerConfig = providerOverride ?? {
      provider: config.recluster.llmProvider,
      model: config.recluster.llmModel,
    };

    const raw = await callChat(providerConfig, storySystemPrompt, prompt, true, activity);

    if (raw.trim() === '1' && existingStory) {
      return { coherent: true, title: existingStory.title, summary: existingStory.summary };
    }

    const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.coherent === true && typeof parsed.title === 'string') {
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : null;
      return { coherent: true, title: parsed.title.trim(), summary };
    }

    if (parsed.coherent === false && Array.isArray(parsed.groups)) {
      const groups: number[][] = parsed.groups.map((g: unknown[]) =>
        g.map((idx) => {
          const i = (typeof idx === 'number' ? idx : parseInt(String(idx), 10)) - 1;
          return articles[i]?.id;
        }).filter((id): id is number => id != null),
      );
      const validGroups = groups.filter((g) => g.length > 0);
      if (validGroups.length >= 2) {
        return { coherent: false, groups: validGroups };
      }
    }

    const title = parsed.title ?? parsed.headline;
    if (typeof title === 'string' && title.trim()) {
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : null;
      return { coherent: true, title: title.trim(), summary };
    }

    return null;
  } catch (err) {
    logger.error({ err }, 'Story title/summary generation failed');
    return null;
  }
}
