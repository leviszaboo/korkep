export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { searchStories } from '@/lib/api';
import { BiasBar } from '@/components/BiasBar';
import { TopicBadge } from '@/components/Badge';
import { timeAgo } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Search',
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      {q ? (
        <Suspense fallback={<SearchLoading />}>
          <SearchResults query={q} />
        </Suspense>
      ) : (
        <div className="py-16 text-center">
          <p className="text-muted">Use the search in the header to find stories.</p>
        </div>
      )}
    </div>
  );
}

async function SearchResults({ query }: { query: string }) {
  const { data: results } = await searchStories(query);

  if (results.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted">No results for &ldquo;{query}&rdquo;</p>
        <p className="mt-1 text-sm text-faint">Try a different search term.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-faint">{results.length} results</p>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {results.map((result) => (
          <Link
            key={result.storyId}
            href={`/stories/${result.storyId}`}
            className="group block"
          >
            {result.imageUrl ? (
              <article className="relative aspect-[3/2] overflow-hidden">
                <img
                  src={result.imageUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 flex flex-col gap-1.5 p-4">
                  <div className="flex items-center gap-1.5">
                    {result.storyTopics?.map((t) => <TopicBadge key={t} topic={t} />)}
                    <span className="text-[11px] text-white/50">
                      {result.matchedArticles} {result.matchedArticles === 1 ? 'match' : 'matches'}
                    </span>
                  </div>
                  <h3 className="text-base font-medium leading-snug text-white line-clamp-2">
                    {result.storyTitle}
                  </h3>
                  <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                    <span>{result.sourceCount} {result.sourceCount === 1 ? 'source' : 'sources'}</span>
                    {result.latestPublishedAt && (
                      <>
                        <span>&middot;</span>
                        <span>{timeAgo(result.latestPublishedAt)}</span>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ) : (
              <article className="flex aspect-[3/2] flex-col overflow-hidden border-b border-border transition-all">
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-center gap-1.5">
                    {result.storyTopics?.map((t) => <TopicBadge key={t} topic={t} />)}
                    <span className="text-[11px] text-faint">
                      {result.matchedArticles} {result.matchedArticles === 1 ? 'match' : 'matches'}
                    </span>
                  </div>
                  <h3 className="text-base font-medium leading-snug text-foreground group-hover:text-accent transition-colors line-clamp-2">
                    {result.storyTitle}
                  </h3>
                  {result.storySummary && (
                    <p className="text-sm text-muted line-clamp-2">{result.storySummary}</p>
                  )}
                </div>
                <div className="border-t border-border/50 p-4 pt-3">
                  <div className="flex items-center gap-1.5 text-xs text-faint">
                    <span>{result.sourceCount} {result.sourceCount === 1 ? 'source' : 'sources'}</span>
                    {result.latestPublishedAt && (
                      <>
                        <span>&middot;</span>
                        <span>{timeAgo(result.latestPublishedAt)}</span>
                      </>
                    )}
                  </div>
                </div>
              </article>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

function SearchLoading() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="aspect-[3/2] animate-pulse border-b border-border bg-surface p-4">
          <div className="flex h-full flex-col justify-end gap-2">
            <div className="h-4 w-16 rounded bg-elevated" />
            <div className="h-5 w-3/4 rounded bg-elevated" />
            <div className="h-4 w-full rounded bg-elevated" />
            <div className="h-3 w-24 rounded bg-elevated" />
          </div>
        </div>
      ))}
    </div>
  );
}
