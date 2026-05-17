'use client';

import { useSearchParams } from 'next/navigation';
import { useFilter } from './FilterContext';

const periods = [
  { key: 'today', label: 'Ma' },
  { key: 'yesterday', label: 'Tegnap' },
  { key: 'week', label: 'Régebben' },
];

export function DateFilter() {
  const searchParams = useSearchParams();
  const { optimisticSince, navigate } = useFilter();

  function handleClick(since: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('since', since);
    params.delete('page');
    const qs = params.toString();
    const href = `/?${qs}`;
    navigate(href, { since });
  }

  return (
    <div className="flex items-center gap-1 rounded-full bg-surface p-0.5">
      {periods.map((period) => (
        <button
          key={period.key}
          onClick={() => handleClick(period.key)}
          className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-colors ${
            optimisticSince === period.key
              ? 'bg-foreground text-base font-medium'
              : 'text-muted hover:text-foreground'
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
