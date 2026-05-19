import type { Paginated, Story } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function getStoriesClient(
  page = 1,
  limit = 20,
  topic?: string | null,
  sort: 'relevance' | 'latest' = 'relevance',
  since?: string | null,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
  if (topic) params.set('topic', topic);
  if (since) params.set('since', since);

  const res = await fetch(`${API_URL}/api/stories?${params}`, {
    cache: 'no-store',
    signal,
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<Paginated<Story>>;
}
