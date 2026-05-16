'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const periods = [
  { key: '', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
];

export function DateFilter() {
  const searchParams = useSearchParams();
  const activeSince = searchParams.get('since') ?? '';
  const topic = searchParams.get('topic');
  const sort = searchParams.get('sort');

  function buildHref(since: string) {
    const params = new URLSearchParams();
    if (topic) params.set('topic', topic);
    if (sort) params.set('sort', sort);
    if (since) params.set('since', since);
    const qs = params.toString();
    return qs ? `/?${qs}` : '/';
  }

  return (
    <div className="flex items-center gap-1 rounded-full bg-surface p-0.5">
      {periods.map((period) => (
        <Link
          key={period.key}
          href={buildHref(period.key)}
          className={`rounded-full px-3 py-1 text-xs transition-colors ${
            activeSince === period.key
              ? 'bg-foreground text-base font-medium'
              : 'text-muted hover:text-foreground'
          }`}
        >
          {period.label}
        </Link>
      ))}
    </div>
  );
}
