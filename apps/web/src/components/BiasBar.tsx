import type { BiasCounts } from '@/lib/types';

interface BiasBarProps {
  counts: BiasCounts;
  showLabels?: boolean;
}

export function BiasBar({ counts, showLabels = false }: BiasBarProps) {
  const total = counts.left + counts.center + counts.right;
  if (total === 0) return null;

  const pct = (n: number) => `${(n / total) * 100}%`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded bg-elevated">
        {counts.left > 0 && (
          <div className="bg-bias-left transition-all" style={{ width: pct(counts.left) }} />
        )}
        {counts.center > 0 && (
          <div className="bg-bias-center transition-all" style={{ width: pct(counts.center) }} />
        )}
        {counts.right > 0 && (
          <div className="bg-bias-right transition-all" style={{ width: pct(counts.right) }} />
        )}
      </div>

      {showLabels && (
        <div className="flex gap-3 text-xs font-semibold">
          {counts.left > 0 && (
            <span className="flex items-center gap-1 text-bias-left">
              <span className="size-1.5 rounded-full bg-bias-left" />
              {counts.left} bal
            </span>
          )}
          {counts.center > 0 && (
            <span className="flex items-center gap-1 text-bias-center">
              <span className="size-1.5 rounded-full bg-bias-center" />
              {counts.center} közép
            </span>
          )}
          {counts.right > 0 && (
            <span className="flex items-center gap-1 text-bias-right">
              <span className="size-1.5 rounded-full bg-bias-right" />
              {counts.right} jobb
            </span>
          )}
        </div>
      )}
    </div>
  );
}
