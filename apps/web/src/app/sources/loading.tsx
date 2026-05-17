export default function SourcesLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="h-7 w-32 animate-pulse rounded bg-elevated" />
        <div className="h-4 w-48 animate-pulse rounded bg-elevated" />
      </div>

      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-border" />
        <div className="size-5 animate-pulse rounded-full bg-elevated" />
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex animate-pulse items-center justify-between rounded-lg border border-border/60 bg-surface/50 p-4">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-full bg-elevated" />
              <div className="flex flex-col gap-1.5">
                <div className="h-4 w-28 rounded bg-elevated" />
                <div className="h-3 w-36 rounded bg-elevated" />
              </div>
            </div>
            <div className="h-4 w-16 rounded bg-elevated" />
          </div>
        ))}
      </div>
    </div>
  );
}
