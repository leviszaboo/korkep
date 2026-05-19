export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStory, getRelatedStories } from '@/lib/api';
import { BiasBar } from '@/components/BiasBar';
import { TopicBadge } from '@/components/Badge';
import { BackButton } from '@/components/BackButton';
import { StoryDetailSkeleton } from '@/components/Skeleton';
import { StoryDetailClient } from '@/components/StoryDetailClient';
import { StoryCard } from '@/components/StoryCard';
import { timeAgo } from '@/lib/utils';
import type { BiasCounts } from '@/lib/types';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const story = await getStory(Number(id));
    return { title: story.title };
  } catch {
    return { title: 'Story not found' };
  }
}

export default async function StoryPage({ params }: Props) {
  const { id } = await params;

  return (
    <Suspense fallback={<StoryDetailSkeleton />}>
      <StoryContent id={Number(id)} />
    </Suspense>
  );
}

async function StoryContent({ id }: { id: number }) {
  let story;
  try {
    story = await getStory(id);
  } catch {
    notFound();
  }

  const bias: BiasCounts = { left: 0, center: 0, right: 0 };
  for (const article of story.articles) {
    const r = article.source.biasRating;
    if (r === 'left' || r === 'center-left') bias.left++;
    else if (r === 'center') bias.center++;
    else bias.right++;
  }

  const latestPublishedAt = story.articles.find((a) => a.publishedAt)?.publishedAt ?? story.updatedAt;
  const heroImage = story.articles.find((a) => a.imageUrl)?.imageUrl ?? null;

  let relatedStories: Awaited<ReturnType<typeof getRelatedStories>>['data'] = [];
  try {
    const result = await getRelatedStories(id);
    relatedStories = result.data;
  } catch {}

  return (
    <div className="flex flex-col gap-8">
      <BackButton />

      {heroImage ? (
        <div className="relative overflow-hidden rounded-lg">
          <div className="aspect-[4/3] sm:aspect-[5/2]">
            <img
              src={heroImage}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/5" />
          <div className="absolute bottom-0 left-0 right-0 flex flex-col gap-3 p-5 sm:p-6 md:p-8">
            <div className="flex items-center gap-2">
              {story.topics?.map((t) => <TopicBadge key={t} topic={t} />)}
              <span className="text-xs text-white/60">{timeAgo(latestPublishedAt)}</span>
            </div>
            <h1 className="font-serif text-2xl font-bold leading-tight text-white md:text-3xl">
              {story.title}
            </h1>
            {story.summary && (
              <p className="max-w-2xl text-sm leading-relaxed text-white/70 line-clamp-2">
                {story.summary}
              </p>
            )}
            <div className="max-w-xs">
              <BiasBar counts={bias} showLabels />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            {story.topics?.map((t) => <TopicBadge key={t} topic={t} />)}
            <span className="text-xs text-faint">{timeAgo(latestPublishedAt)}</span>
          </div>
          <h1 className="font-serif text-2xl font-bold leading-tight text-foreground md:text-3xl">
            {story.title}
          </h1>
          {story.summary && (
            <p className="text-base leading-relaxed text-muted">{story.summary}</p>
          )}
          <BiasBar counts={bias} showLabels />
        </div>
      )}

      <StoryDetailClient articles={story.articles} bias={bias} />

      {relatedStories.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 className="text-[9px] font-bold uppercase tracking-[2px] text-faint">
            Kapcsolódó történetek
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {relatedStories.map((rs) => (
              <StoryCard key={rs.id} story={rs} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
