export function HeroSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden bg-elevated">
      <div className="flex flex-col justify-end aspect-[2/1] p-6 sm:aspect-[5/2] sm:p-8">
        <div className="mb-3 flex gap-2">
          <div className="h-5 w-14 rounded bg-surface/30" />
          <div className="h-5 w-20 rounded bg-surface/30" />
        </div>
        <div className="mb-2 h-8 w-3/4 rounded bg-surface/30" />
        <div className="h-4 w-1/2 rounded bg-surface/30" />
      </div>
    </div>
  );
}

export function TrendingStripSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-4 w-20 animate-pulse rounded bg-elevated" />
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <CompactCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function CompactCardSkeleton() {
  return (
    <div className="animate-pulse border-b border-border p-3.5">
      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5">
          <div className="h-5 w-14 rounded bg-elevated" />
        </div>
        <div className="h-4 w-3/4 rounded bg-elevated" />
        <div className="h-4 w-1/2 rounded bg-elevated" />
        <div className="h-[3px] w-full bg-elevated" />
        <div className="h-3 w-20 rounded bg-elevated" />
      </div>
    </div>
  );
}

export function StoryCardSkeleton() {
  return (
    <div className="aspect-[3/2] animate-pulse overflow-hidden bg-elevated">
      <div className="flex h-full flex-col justify-end p-4">
        <div className="mb-2 flex gap-2">
          <div className="h-5 w-14 rounded bg-surface/30" />
        </div>
        <div className="mb-2 h-5 w-3/4 rounded bg-surface/30" />
        <div className="mb-2 h-[3px] w-full bg-surface/30" />
        <div className="flex items-center justify-between">
          <div className="flex -space-x-1.5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="size-6 rounded-full bg-surface/30" />
            ))}
          </div>
          <div className="h-3 w-20 rounded bg-surface/30" />
        </div>
      </div>
    </div>
  );
}

export function StoryDetailSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6">
      <div className="h-4 w-20 rounded bg-elevated" />
      <div className="flex flex-col gap-3">
        <div className="h-8 w-3/4 rounded bg-elevated" />
        <div className="h-4 w-full rounded bg-elevated" />
        <div className="h-[3px] w-full bg-elevated" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 border-b border-border bg-surface" />
        ))}
      </div>
    </div>
  );
}
