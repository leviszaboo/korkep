import type { Story, StoryDetail, Source, SearchResult, Paginated, ComparedStory } from './types';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

async function get<T>(path: string, options?: { revalidate?: number }): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    next: { revalidate: options?.revalidate ?? 60 },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export async function getStories(page = 1, limit = 20, topic?: string, sort: 'relevance' | 'latest' = 'relevance', since?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
  if (topic) params.set('topic', topic);
  if (since) params.set('since', since);
  return get<Paginated<Story>>(`/api/stories?${params}`, { revalidate: 30 });
}

export async function getStory(id: number) {
  return get<StoryDetail>(`/api/stories/${id}`, { revalidate: 30 });
}

export async function getSources() {
  return get<{ data: Source[] }>('/api/sources', { revalidate: 300 });
}

export async function searchStories(query: string) {
  return get<{ data: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`, { revalidate: 30 });
}

export async function getRelatedStories(storyId: number) {
  return get<{ data: Story[] }>(`/api/stories/${storyId}/related`, { revalidate: 300 });
}

export async function getSharedStories(slugA: string, slugB: string) {
  return get<{ data: ComparedStory[] }>(`/api/sources/compare?a=${encodeURIComponent(slugA)}&b=${encodeURIComponent(slugB)}`, { revalidate: 60 });
}
