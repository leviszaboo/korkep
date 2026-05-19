'use client';

import { Suspense } from 'react';
import { FilterProvider, useFilter } from './FilterContext';
import { TopicFilter } from './TopicFilter';
import { HeroSkeleton, StoryCardSkeleton, TrendingStripSkeleton } from './Skeleton';

export function FilterShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <FilterProvider>
        <div className="flex flex-col gap-6">
          <TopicFilter />
          <PendingOverlay>{children}</PendingOverlay>
        </div>
      </FilterProvider>
    </Suspense>
  );
}

function PendingOverlay({ children }: { children: React.ReactNode }) {
  const { isPending } = useFilter();

  if (isPending) {
    return <StoriesSkeleton />;
  }

  return <>{children}</>;
}

function StoriesSkeleton() {
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
