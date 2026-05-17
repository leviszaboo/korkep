export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import Link from 'next/link';
import { getStories } from '@/lib/api';
import { StoryCard } from '@/components/StoryCard';
import { TopicFilter } from '@/components/TopicFilter';
import { TrendingStrip } from '@/components/TrendingStrip';
import { InfiniteScroll } from '@/components/InfiniteScroll';
import { NewsFeed } from '@/components/NewsFeed';
import { HeroSkeleton, StoryCardSkeleton, TrendingStripSkeleton } from '@/components/Skeleton';
import type { Story } from '@/lib/types';


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

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string; since?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <Suspense>
        <TopicFilter />
      </Suspense>

      <Suspense fallback={<StoriesLoading />}>
        <Stories topic={params.topic} since={params.since} />
      </Suspense>
    </div>
  );
}

async function Stories({ topic, since }: { topic?: string; since?: string }) {
  const limit = topic ? 20 : 50;
  const { data: stories, pagination } = await getStories(1, limit, topic, 'relevance', since);

  if (stories.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted">No stories yet.</p>
        <p className="mt-1 text-sm text-faint">Check back soon — articles are being collected.</p>
      </div>
    );
  }

  if (!topic && !since) {
    return <GroupedView stories={stories} pagination={pagination} />;
  }

  return (
    <FlatView
      stories={stories}
      pagination={pagination}
      topic={topic}
      since={since}
    />
  );
}


const sectionLayouts = ['highlight', 'triple', 'standard'] as const;
type SectionLayout = (typeof sectionLayouts)[number];

function GroupedView({
  stories,
  pagination,
}: {
  stories: Story[];
  pagination: { page: number; limit: number; total: number };
}) {
  const hero = stories[0];
  const trendingEnd = Math.min(8, stories.length);
  const trending = stories.slice(1, trendingEnd);
  const rest = stories.slice(trendingEnd);

  const grouped = new Map<string, Story[]>();
  const ungrouped: Story[] = [];
  for (const story of rest) {
    const primaryTopic = story.topics?.find((t) => topicLabels[t]);
    if (primaryTopic) {
      const arr = grouped.get(primaryTopic) ?? [];
      arr.push(story);
      grouped.set(primaryTopic, arr);
    } else {
      ungrouped.push(story);
    }
  }

  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">
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
          <InfiniteScroll initialPage={1} totalPages={totalPages} sort="relevance" />
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
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <StoryCard story={stories[0]} />
        <div className="grid auto-rows-fr gap-4">
          {stories.slice(1, 3).map((s) => (
            <StoryCard key={s.id} story={s} compact fill />
          ))}
        </div>
      </div>
    );
  }

  if (layout === 'triple') {
    return (
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {stories.slice(0, 3).map((s) => (
          <StoryCard key={s.id} story={s} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {stories.slice(0, 4).map((s) => (
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
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">
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
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-10">
        <HeroSkeleton />
        <TrendingStripSkeleton />
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <StoryCardSkeleton key={i} />
          ))}
        </div>
      </div>
      <div className="hidden lg:block">
        <div className="flex flex-col gap-4">
          <div className="h-4 w-24 animate-pulse rounded bg-elevated" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 border-l-2 border-border py-3 pl-3">
              <div className="h-4 w-full animate-pulse rounded bg-elevated" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-elevated" />
              <div className="h-1.5 w-[180px] animate-pulse rounded-full bg-elevated" />
              <div className="h-3 w-24 animate-pulse rounded bg-elevated" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
