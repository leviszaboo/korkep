import Link from 'next/link';
import type { Story } from '@/lib/types';
import { timeAgo, isFresh } from '@/lib/utils';
import { BiasBar } from './BiasBar';
import { FreshBadge, TopicBadge } from './Badge';
import { SourceAvatars } from './SourceAvatars';

interface StoryCardProps {
  story: Story;
  featured?: boolean;
  compact?: boolean;
}

export function StoryCard({ story, featured = false, compact = false }: StoryCardProps) {
  if (featured) return <FeaturedCard story={story} />;
  if (compact) return <CompactCard story={story} />;
  return <DefaultCard story={story} />;
}

function WidelyCoveredBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2 py-0.5 text-[11px] font-medium text-accent">
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 2L2 5.5L8 9L14 5.5L8 2Z" />
        <path d="M2 8L8 11.5L14 8" />
        <path d="M2 10.5L8 14L14 10.5" />
      </svg>
      {count} sources
    </span>
  );
}

function FeaturedCard({ story }: { story: Story }) {
  const widelyCovered = story.sourceCount >= 8;

  if (story.imageUrl) {
    return (
      <Link href={`/stories/${story.id}`} className="group block">
        <article className="relative overflow-hidden rounded-xl">
          <div className="aspect-[2/1] sm:aspect-[5/2]">
            <img
              src={story.imageUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/5" />
          <div className="absolute bottom-0 left-0 right-0 flex flex-col gap-3 p-5 sm:p-6 md:p-8">
            <div className="flex items-center gap-2">
              {isFresh(story.latestPublishedAt) && <FreshBadge />}
              {story.topics?.map((t) => <TopicBadge key={t} topic={t} />)}
              {widelyCovered && <WidelyCoveredBadge count={story.sourceCount} />}
            </div>
            <h2 className="text-xl font-bold leading-tight text-white sm:text-2xl md:text-3xl">
              {story.title}
            </h2>
            {story.summary && (
              <p className="max-w-2xl text-sm leading-relaxed text-white/70 line-clamp-2">
                {story.summary}
              </p>
            )}
            <div className="max-w-xs">
              <BiasBar counts={story.sourceBias} />
            </div>
            <div className="flex items-center justify-between">
              <SourceAvatars sources={story.sources} />
              <div className="flex items-center gap-1.5 text-xs text-white/60">
                <SourcesIcon />
                <span>
                  {story.sourceCount} {story.sourceCount === 1 ? 'source' : 'sources'}
                </span>
                <span className="mx-0.5">&middot;</span>
                <ClockIcon />
                <span>{timeAgo(story.latestPublishedAt)}</span>
              </div>
            </div>
          </div>
        </article>
      </Link>
    );
  }

  return (
    <Link href={`/stories/${story.id}`} className="group block">
      <article className="overflow-hidden rounded-xl border border-border bg-surface p-6 transition-all hover:border-border-strong hover:shadow-lg sm:p-8">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            {isFresh(story.latestPublishedAt) && <FreshBadge />}
            {story.topics?.map((t) => <TopicBadge key={t} topic={t} />)}
            {widelyCovered && <WidelyCoveredBadge count={story.sourceCount} />}
          </div>
          <h2 className="text-xl font-bold leading-tight text-foreground transition-colors group-hover:text-accent sm:text-2xl md:text-3xl">
            {story.title}
          </h2>
          {story.summary && (
            <p className="text-sm leading-relaxed text-muted line-clamp-3">{story.summary}</p>
          )}
          <BiasBar counts={story.sourceBias} />
          <div className="flex items-center justify-between">
            <SourceAvatars sources={story.sources} />
            <div className="flex items-center gap-1.5 text-xs text-faint">
              <SourcesIcon />
              <span>
                {story.sourceCount} {story.sourceCount === 1 ? 'source' : 'sources'}
              </span>
              <span className="mx-0.5">&middot;</span>
              <ClockIcon />
              <span>{timeAgo(story.latestPublishedAt)}</span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

function CompactCard({ story }: { story: Story }) {
  const widelyCovered = story.sourceCount >= 8;

  return (
    <Link href={`/stories/${story.id}`} className="group block">
      <article className="overflow-hidden rounded-lg border border-border bg-surface p-3.5 transition-all hover:border-border-strong hover:shadow-md">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            {isFresh(story.latestPublishedAt) && <FreshBadge />}
            {story.topics?.slice(0, 2).map((t) => <TopicBadge key={t} topic={t} />)}
            {widelyCovered && <WidelyCoveredBadge count={story.sourceCount} />}
          </div>

          <h2 className="text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-accent line-clamp-2">
            {story.title}
          </h2>

          <div className="flex items-center gap-2">
            <BiasBar counts={story.sourceBias} />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-faint">
            <SourcesIcon />
            <span>{story.sourceCount}</span>
            <span className="mx-0.5">&middot;</span>
            <ClockIcon />
            <span>{timeAgo(story.latestPublishedAt)}</span>
          </div>
        </div>
      </article>
    </Link>
  );
}

function DefaultCard({ story }: { story: Story }) {
  const widelyCovered = story.sourceCount >= 8;

  const badges = (
    <div className="flex flex-wrap items-center gap-1.5">
      {isFresh(story.latestPublishedAt) && <FreshBadge />}
      {story.topics?.map((t) => <TopicBadge key={t} topic={t} />)}
      {widelyCovered && <WidelyCoveredBadge count={story.sourceCount} />}
    </div>
  );

  if (story.imageUrl) {
    return (
      <Link href={`/stories/${story.id}`} className="group block">
        <article className="relative aspect-[3/2] overflow-hidden rounded-lg">
          <img
            src={story.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 flex flex-col gap-2 p-4">
            {badges}
            <h2 className="text-base font-semibold leading-snug text-white line-clamp-2">
              {story.title}
            </h2>
            <BiasBar counts={story.sourceBias} />
            <div className="flex items-center justify-between">
              <SourceAvatars sources={story.sources} max={3} />
              <div className="flex items-center gap-1.5 text-xs text-white/60">
                <SourcesIcon />
                <span>{story.sourceCount}</span>
                <span className="mx-0.5">&middot;</span>
                <ClockIcon />
                <span>{timeAgo(story.latestPublishedAt)}</span>
              </div>
            </div>
          </div>
        </article>
      </Link>
    );
  }

  return (
    <Link href={`/stories/${story.id}`} className="group block">
      <article className="flex aspect-[3/2] flex-col overflow-hidden rounded-lg border border-border bg-surface transition-all hover:border-border-strong hover:shadow-md">
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          {badges}
          <h2 className="text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-accent line-clamp-2">
            {story.title}
          </h2>
          {story.summary && (
            <p className="text-sm leading-relaxed text-muted line-clamp-2">{story.summary}</p>
          )}
        </div>
        <div className="flex flex-col gap-2.5 border-t border-border/50 p-4 pt-3">
          <BiasBar counts={story.sourceBias} />
          <div className="flex items-center justify-between">
            <SourceAvatars sources={story.sources} max={3} />
            <div className="flex items-center gap-1.5 text-xs text-faint">
              <SourcesIcon />
              <span>{story.sourceCount}</span>
              <span className="mx-0.5">&middot;</span>
              <ClockIcon />
              <span>{timeAgo(story.latestPublishedAt)}</span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

function SourcesIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 1.5L2 3.5L6 5.5L10 3.5L6 1.5Z" />
      <path d="M2 5.5L6 7.5L10 5.5" />
      <path d="M2 7.5L6 9.5L10 7.5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    >
      <circle cx="6" cy="6" r="4.5" />
      <polyline points="6,3.5 6,6 8,7" />
    </svg>
  );
}
