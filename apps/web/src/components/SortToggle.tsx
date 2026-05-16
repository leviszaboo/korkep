'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export function SortToggle() {
  const searchParams = useSearchParams();
  const activeSort = searchParams.get('sort') ?? 'relevance';
  const topic = searchParams.get('topic');
  const since = searchParams.get('since');

  function buildHref(sort: string) {
    const params = new URLSearchParams();
    params.set('sort', sort);
    if (topic) params.set('topic', topic);
    if (since) params.set('since', since);
    return `/?${params}`;
  }

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full bg-surface p-0.5">
      <SortPill href={buildHref('relevance')} active={activeSort === 'relevance'}>
        <FlameIcon />
        Relevant
      </SortPill>
      <SortPill href={buildHref('latest')} active={activeSort === 'latest'}>
        <ClockIcon />
        Latest
      </SortPill>
    </div>
  );
}

function SortPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors ${
        active
          ? 'bg-foreground text-base font-medium'
          : 'text-muted hover:text-foreground'
      }`}
    >
      {children}
    </Link>
  );
}

function FlameIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 1C6 1 2.5 4.5 2.5 7C2.5 9 4 10.5 6 10.5C8 10.5 9.5 9 9.5 7C9.5 4.5 6 1 6 1Z" />
      <path d="M6 6C6 6 4.5 7.5 4.5 8.5C4.5 9.3 5.2 10 6 10C6.8 10 7.5 9.3 7.5 8.5C7.5 7.5 6 6 6 6Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <circle cx="6" cy="6" r="4.5" />
      <polyline points="6,3.5 6,6 8,7" />
    </svg>
  );
}
