import { HeroSkeleton, StoryCardSkeleton, TrendingStripSkeleton } from '@/components/Skeleton';

export default function HomeLoading() {
  return (
    <div className="flex flex-col gap-6">
      <FilterBarSkeleton />

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
        <NewsFeedSkeleton />
      </div>
    </div>
  );
}

function FilterBarSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1 rounded-full bg-surface p-0.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 w-16 animate-pulse rounded-full bg-elevated" />
        ))}
      </div>
      <div className="h-5 w-px shrink-0 bg-border" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-9 w-20 shrink-0 animate-pulse rounded-full bg-surface" />
        ))}
      </div>
    </div>
  );
}

function NewsFeedSkeleton() {
  return (
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
  );
}
