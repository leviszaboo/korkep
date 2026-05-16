'use client';

import { useState } from 'react';
import type { Story } from '@/lib/types';
import { loadMoreStories } from '@/lib/actions';
import { StoryCard } from './StoryCard';

interface LoadMoreButtonProps {
  currentPage: number;
  totalPages: number;
  topic?: string;
  sort: string;
}

export function LoadMoreButton({ currentPage, totalPages, topic, sort }: LoadMoreButtonProps) {
  const [extraStories, setExtraStories] = useState<Story[]>([]);
  const [page, setPage] = useState(currentPage);
  const [loading, setLoading] = useState(false);

  const hasMore = page < totalPages;

  async function handleLoadMore() {
    setLoading(true);
    try {
      const nextPage = page + 1;
      const sortMode = sort === 'latest' ? 'latest' as const : 'relevance' as const;
      const { stories } = await loadMoreStories(nextPage, 20, topic, sortMode);
      setExtraStories((prev) => [...prev, ...stories]);
      setPage(nextPage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {extraStories.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {extraStories.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="rounded-lg border border-border bg-surface px-6 py-2.5 text-sm font-medium text-muted transition-all hover:border-border-strong hover:text-foreground hover:shadow-sm disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Spinner />
                Loading...
              </span>
            ) : (
              'Load more stories'
            )}
          </button>
        </div>
      )}
    </>
  );
}

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
