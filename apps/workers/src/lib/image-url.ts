import { IMAGE_EXCLUDED_SOURCE_SLUGS } from '@korkep/shared';

const USER_AGENT = 'KorkepBot/0.1 (+https://korkep.hu)';
const TIMEOUT_MS = 8_000;

type FetchLike = typeof fetch;

export type ImageValidationResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export function shouldUseImageFromSource(sourceSlug: string): boolean {
  return !IMAGE_EXCLUDED_SOURCE_SLUGS.includes(sourceSlug as (typeof IMAGE_EXCLUDED_SOURCE_SLUGS)[number]);
}

export async function validateImageUrl(
  rawUrl: string | null | undefined,
  options: {
    sourceSlug: string;
    fetchImpl?: FetchLike;
  },
): Promise<ImageValidationResult> {
  if (!shouldUseImageFromSource(options.sourceSlug)) {
    return { ok: false, reason: 'excluded-source' };
  }

  const url = normalizeImageUrl(rawUrl);
  if (!url) return { ok: false, reason: 'invalid-url' };

  const fetchImpl = options.fetchImpl ?? fetch;
  const head = await requestImage(fetchImpl, url, 'HEAD');

  if (head.ok) return { ok: true, url };
  if (head.reason !== 'http-405' && head.reason !== 'http-501') return head;

  return requestImage(fetchImpl, url, 'GET');
}

function normalizeImageUrl(rawUrl: string | null | undefined): string | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

async function requestImage(
  fetchImpl: FetchLike,
  url: string,
  method: 'HEAD' | 'GET',
): Promise<ImageValidationResult> {
  try {
    const res = await fetchImpl(url, {
      method,
      headers: {
        'User-Agent': USER_AGENT,
        ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return { ok: false, reason: `http-${res.status}` };

    const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('image/')) {
      return { ok: false, reason: 'non-image-content-type' };
    }

    return { ok: true, url };
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError'
      ? 'timeout'
      : 'fetch-failed';
    return { ok: false, reason };
  }
}
