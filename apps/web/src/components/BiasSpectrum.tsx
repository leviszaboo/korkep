'use client';

import type { Source, BiasRating } from '@/lib/types';

const zones: { key: BiasRating; label: string; bg: string; color: string }[] = [
  { key: 'left', label: 'Bal', bg: 'bg-bias-left-bg', color: 'text-bias-left' },
  { key: 'center-left', label: 'Közép-bal', bg: 'bg-bias-left-bg/50', color: 'text-bias-left' },
  { key: 'center', label: 'Közép', bg: 'bg-bias-center-bg', color: 'text-bias-center' },
  { key: 'center-right', label: 'Közép-jobb', bg: 'bg-bias-right-bg/50', color: 'text-bias-right' },
  { key: 'right', label: 'Jobb', bg: 'bg-bias-right-bg', color: 'text-bias-right' },
];

export function BiasSpectrum({ sources }: { sources: Source[] }) {
  const grouped = new Map<BiasRating, Source[]>();
  for (const zone of zones) {
    grouped.set(zone.key, []);
  }
  for (const source of sources) {
    const rating = source.biasRating as BiasRating;
    grouped.get(rating)?.push(source);
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[9px] font-bold uppercase tracking-[2px] text-faint">
        Politikai spektrum
      </h2>
      <div className="grid grid-cols-5 gap-px overflow-hidden rounded-lg border border-border">
        {zones.map((zone) => {
          const zoneSources = grouped.get(zone.key) ?? [];
          return (
            <div key={zone.key} className={`flex flex-col gap-2 p-2 sm:p-3 ${zone.bg}`}>
              <span className={`text-[8px] sm:text-[9px] font-bold uppercase tracking-[1.5px] ${zone.color}`}>
                {zone.label}
              </span>
              <div className="flex flex-col gap-1.5">
                {zoneSources.map((source) => (
                  <a
                    key={source.id}
                    href={`#source-${source.slug}`}
                    className="flex items-center gap-2 rounded px-1 py-1 text-xs text-foreground transition-colors hover:bg-elevated/50 sm:px-1.5"
                    title={source.name}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(`source-${source.slug}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                  >
                    {source.logoUrl ? (
                      <img src={source.logoUrl} alt={source.name} className="size-5 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-elevated text-[9px] font-semibold text-muted">
                        {source.name.slice(0, 2)}
                      </span>
                    )}
                    <span className="hidden truncate font-medium sm:inline">{source.name}</span>
                  </a>
                ))}
                {zoneSources.length === 0 && (
                  <span className="text-[10px] text-faint italic">&mdash;</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
