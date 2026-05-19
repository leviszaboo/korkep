'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Story, Paginated } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { BiasBar } from './BiasBar';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function NewsFeed() {
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic');
  const [stories, setStories] = useState<Story[]>([]);

  useEffect(() => {
    const params = new URLSearchParams({ sort: 'latest', limit: '30' });
    if (topic) params.set('topic', topic);
    fetch(`${API_URL}/api/stories?${params}`)
      .then((res) => res.json())
      .then((data: Paginated<Story>) => setStories(data.data))
      .catch(() => {});
  }, [topic]);

  if (stories.length === 0) return null;

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col">
        <h2 className="mb-3 flex shrink-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
          <PulseIcon />
          Legfrissebb
        </h2>
        <div className="flex flex-col overflow-y-auto overscroll-contain">
          {stories.map((story) => (
            <Link
              key={story.id}
              href={`/stories/${story.id}`}
              className="group flex flex-col gap-1.5 border-l-2 border-border py-3 pl-3 transition-colors hover:border-accent"
            >
              <h3 className="font-serif text-[13px] font-medium leading-snug text-foreground transition-colors group-hover:text-accent line-clamp-2">
                {story.title}
              </h3>
              <div className="max-w-[180px]">
                <BiasBar counts={story.sourceBias} />
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-faint">
                <span>{story.sourceCount} forrás</span>
                <span>&middot;</span>
                <span>{timeAgo(story.latestPublishedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}

function PulseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,6 3,6 4.5,2 6,10 7.5,4 9,6 11,6" />
    </svg>
  );
}
