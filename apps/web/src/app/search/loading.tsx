export default function SearchLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-[3/2] animate-pulse rounded-lg border border-border bg-surface p-4">
            <div className="flex h-full flex-col justify-end gap-2">
              <div className="h-4 w-16 rounded bg-elevated" />
              <div className="h-5 w-3/4 rounded bg-elevated" />
              <div className="h-4 w-full rounded bg-elevated" />
              <div className="h-3 w-24 rounded bg-elevated" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
