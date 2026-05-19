'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getStoriesClient } from '@/lib/client-api';
import type { Story } from '@/lib/types';
import { StoryCard } from '@/components/StoryCard';
import { TrendingStrip } from '@/components/TrendingStrip';
import { InfiniteScroll } from '@/components/InfiniteScroll';
import { NewsFeed } from '@/components/NewsFeed';
import { HeroSkeleton, StoryCardSkeleton, TrendingStripSkeleton, NewsFeedSkeleton } from '@/components/Skeleton';

const topicLabels: Record<string, string> = {
  politika: 'Politika',
  világ: 'Világ',
  gazdaság: 'Gazdaság',
  társadalom: 'Társadalom',
  bűnügyek: 'Bűnügyek',
  sport: 'Sport',
  kultúra: 'Kultúra',
  tudomány: 'Tudomány',
  technológia: 'Technológia',
  egészség: 'Egészség',
  időjárás: 'Időjárás',
  szórakozás: 'Szórakozás',
  vélemény: 'Vélemény',
};

const sectionLayouts = ['highlight', 'triple', 'standard'] as const;
type SectionLayout = (typeof sectionLayouts)[number];

export function MainStoriesClient() {
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic');
  const since = searchParams.get('since') ?? 'today';
  const limit = topic ? 20 : 50;
  const [stories, setStories] = useState<Story[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit, total: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const touchStartY = useRef<number | null>(null);
  const canPull = useRef(false);

  const loadStories = useCallback(
    async (opts?: { refresh?: boolean; signal?: AbortSignal }) => {
      if (opts?.refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(false);

      try {
        const result = await getStoriesClient(1, limit, topic, 'relevance', since, opts?.signal);
        setStories(result.data);
        setPagination(result.pagination);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
        setPullDistance(0);
      }
    },
    [limit, topic, since],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadStories({ signal: controller.signal });
    return () => controller.abort();
  }, [loadStories]);

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    canPull.current = window.scrollY <= 0;
    touchStartY.current = canPull.current ? e.touches[0].clientY : null;
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (touchStartY.current === null || !canPull.current || refreshing) return;
    const distance = e.touches[0].clientY - touchStartY.current;
    if (distance > 0) {
      setPullDistance(Math.min(distance * 0.45, 72));
    }
  }

  function handleTouchEnd() {
    if (pullDistance >= 56 && !refreshing) {
      void loadStories({ refresh: true });
    } else {
      setPullDistance(0);
    }
    touchStartY.current = null;
    canPull.current = false;
  }

  const pullLabel = refreshing ? 'Frissítés...' : pullDistance >= 56 ? 'Engedd el a frissítéshez' : 'Húzd le a frissítéshez';

  return (
    <div
      className="relative"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="pointer-events-none -mt-2 flex justify-center overflow-hidden text-xs text-muted transition-[height]"
        style={{ height: pullDistance || refreshing ? 34 : 0 }}
      >
        <div className="flex items-center gap-2 pt-1">
          <Spinner />
          <span>{pullLabel}</span>
        </div>
      </div>

      {loading ? (
        <StoriesLoading />
      ) : error ? (
        <div className="py-16 text-center">
          <p className="text-muted">Could not load stories.</p>
          <button
            onClick={() => loadStories()}
            className="mt-3 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-base"
          >
            Try again
          </button>
        </div>
      ) : stories.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-muted">No stories yet.</p>
          <p className="mt-1 text-sm text-faint">Check back soon - articles are being collected.</p>
        </div>
      ) : topic ? (
        <FlatView stories={stories} pagination={pagination} topic={topic} since={since} />
      ) : (
        <GroupedView stories={stories} pagination={pagination} since={since} />
      )}
    </div>
  );
}

function GroupedView({
  stories,
  pagination,
  since,
}: {
  stories: Story[];
  pagination: { page: number; limit: number; total: number };
  since?: string;
}) {
  const hero = stories[0];
  const trendingEnd = Math.min(8, stories.length);
  const trending = stories.slice(1, trendingEnd);
  const rest = stories.slice(trendingEnd);

  const { grouped, ungrouped } = useMemo(() => {
    const groupedStories = new Map<string, Story[]>();
    const looseStories: Story[] = [];
    for (const story of rest) {
      const primaryTopic = story.topics?.find((t) => topicLabels[t]);
      if (primaryTopic) {
        const arr = groupedStories.get(primaryTopic) ?? [];
        arr.push(story);
        groupedStories.set(primaryTopic, arr);
      } else {
        looseStories.push(story);
      }
    }
    return { grouped: groupedStories, ungrouped: looseStories };
  }, [rest]);

  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-10">
        <StoryCard story={hero} featured />

        {trending.length > 0 && <TrendingStrip stories={trending} />}

        {Array.from(grouped.entries()).map(([topicKey, topicStories], index) => (
          <section key={topicKey} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">
                {topicLabels[topicKey] ?? topicKey}
              </h2>
              <Link
                href={`/?topic=${topicKey}`}
                className="text-xs text-muted transition-colors hover:text-accent"
              >
                See all &rarr;
              </Link>
            </div>
            <TopicGrid
              layout={sectionLayouts[index % sectionLayouts.length]}
              stories={topicStories}
            />
          </section>
        ))}

        {ungrouped.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">
              More stories
            </h2>
            <MagazineGrid stories={ungrouped} />
          </section>
        )}

        {totalPages > 1 && (
          <InfiniteScroll initialPage={1} totalPages={totalPages} sort="relevance" since={since} />
        )}
      </div>

      <Suspense>
        <NewsFeed />
      </Suspense>
    </div>
  );
}

function TopicGrid({ layout, stories }: { layout: SectionLayout; stories: Story[] }) {
  if (layout === 'highlight' && stories.length >= 2) {
    const first = stories[0];
    const rest = stories.slice(1);
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.4fr_1fr]">
        <StoryCard story={first} />
        <div className="flex flex-col">
          {rest.map((s, i) => (
            <div key={s.id} className={`flex flex-1 flex-col justify-center${i < rest.length - 1 ? ' border-b border-border' : ''}`}>
              <StoryCard story={s} compact fill />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      {stories.map((s) => (
        <StoryCard key={s.id} story={s} />
      ))}
    </div>
  );
}

function MagazineGrid({ stories }: { stories: Story[] }) {
  const rows: React.ReactNode[] = [];
  let i = 0;

  while (i < stories.length) {
    const remaining = stories.length - i;
    const pattern = rows.length % 2;

    if (pattern === 0 && remaining >= 3) {
      rows.push(
        <div key={`row-${i}`} className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {stories.slice(i, i + 3).map((s) => (
            <StoryCard key={s.id} story={s} />
          ))}
        </div>,
      );
      i += 3;
    } else if (pattern === 1 && remaining >= 2) {
      rows.push(
        <div key={`row-${i}`} className="grid gap-4 sm:grid-cols-2">
          {stories.slice(i, i + 2).map((s) => (
            <StoryCard key={s.id} story={s} />
          ))}
        </div>,
      );
      i += 2;
    } else {
      rows.push(
        <div key={`row-${i}`} className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {stories.slice(i, i + Math.min(3, remaining)).map((s) => (
            <StoryCard key={s.id} story={s} />
          ))}
        </div>,
      );
      i += Math.min(3, remaining);
    }
  }

  return <div className="flex flex-col gap-4">{rows}</div>;
}

function FlatView({
  stories,
  pagination,
  topic,
  since,
}: {
  stories: Story[];
  pagination: { page: number; limit: number; total: number };
  topic?: string;
  since?: string;
}) {
  const featured = stories.slice(0, 1);
  const rest = stories.slice(1);
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        {featured.map((story) => (
          <StoryCard key={story.id} story={story} featured />
        ))}

        <MagazineGrid stories={rest} />

        {totalPages > 1 && (
          <InfiniteScroll
            initialPage={1}
            totalPages={totalPages}
            topic={topic}
            sort="relevance"
            since={since}
          />
        )}
      </div>

      <Suspense>
        <NewsFeed />
      </Suspense>
    </div>
  );
}

function StoriesLoading() {
  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-10">
        <HeroSkeleton />
        <TrendingStripSkeleton />
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <StoryCardSkeleton key={i} />
          ))}
        </div>
      </div>
      <div className="hidden xl:block">
        <NewsFeedSkeleton />
      </div>
    </div>
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
