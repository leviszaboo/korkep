import Link from 'next/link';
import type { Story } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { BiasBar } from './BiasBar';

export function NewsFeed({ stories }: { stories: Story[] }) {
  if (stories.length === 0) return null;

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-20">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
          <PulseIcon />
          Legfrissebb
        </h2>
        <div className="flex flex-col">
          {stories.map((story, i) => (
            <Link
              key={story.id}
              href={`/stories/${story.id}`}
              className="group flex flex-col gap-1.5 border-l-2 border-border py-3 pl-3 transition-colors hover:border-accent"
            >
              <h3 className="text-[13px] font-medium leading-snug text-foreground transition-colors group-hover:text-accent line-clamp-2">
                {story.title}
              </h3>
              <div className="max-w-[180px]">
                <BiasBar counts={story.sourceBias} />
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-faint">
                <span>{story.sourceCount} {story.sourceCount === 1 ? 'forrás' : 'forrás'}</span>
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
