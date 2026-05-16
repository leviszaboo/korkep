export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import Link from 'next/link';
import { getStories } from '@/lib/api';
import { StoryCard } from '@/components/StoryCard';
import { TopicFilter } from '@/components/TopicFilter';
import { SortToggle } from '@/components/SortToggle';
import { DateFilter } from '@/components/DateFilter';
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
  searchParams: Promise<{ topic?: string; page?: string; sort?: string; since?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <Suspense>
          <TopicFilter />
        </Suspense>
        <div className="flex shrink-0 items-center gap-2">
          <Suspense>
            <DateFilter />
          </Suspense>
          <Suspense>
            <SortToggle />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<StoriesLoading />}>
        <Stories topic={params.topic} page={params.page} sort={params.sort} since={params.since} />
      </Suspense>
    </div>
  );
}

async function Stories({ topic, page, sort, since }: { topic?: string; page?: string; sort?: string; since?: string }) {
  const currentPage = Number(page) || 1;
  const sortMode = sort === 'latest' ? ('latest' as const) : ('relevance' as const);
  const limit = topic ? 20 : 50;
  const { data: stories, pagination } = await getStories(currentPage, limit, topic, sortMode, since);

  if (stories.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted">No stories yet.</p>
        <p className="mt-1 text-sm text-faint">Check back soon — articles are being collected.</p>
      </div>
    );
  }

  if (!topic && !since && currentPage === 1 && sortMode === 'relevance') {
    return <GroupedView stories={stories} pagination={pagination} sort={sort ?? 'relevance'} />;
  }

  return (
    <FlatView
      stories={stories}
      pagination={pagination}
      topic={topic}
      sort={sort ?? 'relevance'}
      since={since}
      currentPage={currentPage}
    />
  );
}


function GroupedView({
  stories,
  pagination,
  sort,
}: {
  stories: Story[];
  pagination: { page: number; limit: number; total: number };
  sort: string;
}) {
  const hero = stories[0];
  const trendingEnd = Math.min(8, stories.length);
  const trending = stories.slice(1, trendingEnd);
  const rest = stories.slice(trendingEnd);

  const feedStories = [...stories].sort(
    (a, b) => new Date(b.latestPublishedAt).getTime() - new Date(a.latestPublishedAt).getTime(),
  );

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

        {Array.from(grouped.entries()).map(([topicKey, topicStories]) => (
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
            <TopicGrid stories={topicStories} />
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
          <InfiniteScroll initialPage={1} totalPages={totalPages} sort={sort} />
        )}
      </div>

      <NewsFeed stories={feedStories} />
    </div>
  );
}

function TopicGrid({ stories }: { stories: Story[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      {stories.slice(0, 3).map((s) => (
        <StoryCard key={s.id} story={s} compact />
      ))}
    </div>
  );
}

function MagazineGrid({ stories }: { stories: Story[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      {stories.map((s) => (
        <StoryCard key={s.id} story={s} compact />
      ))}
    </div>
  );
}

function FlatView({
  stories,
  pagination,
  topic,
  sort,
  since,
  currentPage,
}: {
  stories: Story[];
  pagination: { page: number; limit: number; total: number };
  topic?: string;
  sort: string;
  since?: string;
  currentPage: number;
}) {
  const featured = currentPage === 1 ? stories.slice(0, 1) : [];
  const rest = currentPage === 1 ? stories.slice(1) : stories;
  const showTimeGroups = sort === 'latest';
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  const feedStories = [...stories].sort(
    (a, b) => new Date(b.latestPublishedAt).getTime() - new Date(a.latestPublishedAt).getTime(),
  );

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">
      <div className="flex min-w-0 flex-col gap-6">
        {featured.map((story) => (
          <StoryCard key={story.id} story={story} featured />
        ))}

        {showTimeGroups ? (
          <TimeGroupedStories stories={rest} />
        ) : (
          <MagazineGrid stories={rest} />
        )}

        {totalPages > 1 && (
          <InfiniteScroll
            initialPage={currentPage}
            totalPages={totalPages}
            topic={topic}
            sort={sort}
            since={since}
          />
        )}
      </div>

      <NewsFeed stories={feedStories} />
    </div>
  );
}

function TimeGroupedStories({ stories }: { stories: Story[] }) {
  const groups = groupByTime(stories);

  return (
    <div className="flex flex-col gap-8">
      {groups.map(({ label, stories: groupStories }) => (
        <section key={label} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-faint">
              {label}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {groupStories.map((story) => (
              <StoryCard key={story.id} story={story} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function groupByTime(stories: Story[]): { label: string; stories: Story[] }[] {
  const map = new Map<string, Story[]>();

  for (const story of stories) {
    const label = getTimeLabel(story.latestPublishedAt);
    const arr = map.get(label) ?? [];
    arr.push(story);
    map.set(label, arr);
  }

  const order = ['Just now', 'Recent', 'Earlier today', 'Yesterday', 'This week', 'Older'];
  const groups: { label: string; stories: Story[] }[] = [];
  for (const label of order) {
    const s = map.get(label);
    if (s && s.length > 0) {
      groups.push({ label, stories: s });
    }
  }

  return groups;
}

function getTimeLabel(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 6) return 'Recent';

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  if (date >= today) return 'Earlier today';
  if (date >= yesterday) return 'Yesterday';
  if (date >= weekAgo) return 'This week';
  return 'Older';
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
