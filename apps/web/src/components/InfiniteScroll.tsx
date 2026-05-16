'use client';

import { useState, useEffect, useRef } from 'react';
import type { Story } from '@/lib/types';
import { loadMoreStories } from '@/lib/actions';
import { StoryCard } from './StoryCard';

interface Props {
  initialPage: number;
  totalPages: number;
  topic?: string;
  sort: string;
  since?: string;
}

export function InfiniteScroll({ initialPage, totalPages, topic, sort, since }: Props) {
  const [extra, setExtra] = useState<Story[]>([]);
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ page: initialPage, loading: false });

  const hasMore = page < totalPages;

  stateRef.current = { page, loading };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || page >= totalPages) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        const { page: currentPage, loading: isLoading } = stateRef.current;
        if (isLoading || currentPage >= totalPages) return;

        stateRef.current.loading = true;
        setLoading(true);

        const nextPage = currentPage + 1;
        const sortMode = sort === 'latest' ? ('latest' as const) : ('relevance' as const);
        loadMoreStories(nextPage, 20, topic, sortMode, since)
          .then(({ stories }) => {
            setExtra((prev) => [...prev, ...stories]);
            setPage(nextPage);
          })
          .finally(() => {
            stateRef.current.loading = false;
            setLoading(false);
          });
      },
      { rootMargin: '400px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [page, totalPages, sort, topic, since]);

  return (
    <>
      {extra.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {extra.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}
        </div>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          )}
        </div>
      )}
    </>
  );
}
