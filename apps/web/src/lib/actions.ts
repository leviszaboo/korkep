'use server';

import { getStories } from './api';
import type { Story } from './types';

export async function loadMoreStories(
  page: number,
  limit: number,
  topic?: string,
  sort: 'relevance' | 'latest' = 'relevance',
  since?: string,
): Promise<{ stories: Story[]; hasMore: boolean }> {
  const { data, pagination } = await getStories(page, limit, topic, sort, since);
  return {
    stories: data,
    hasMore: page * pagination.limit < pagination.total,
  };
}
