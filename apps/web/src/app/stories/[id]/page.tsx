export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStory } from '@/lib/api';
import { BiasBar } from '@/components/BiasBar';
import { TopicBadge } from '@/components/Badge';
import { BackButton } from '@/components/BackButton';
import { StoryDetailSkeleton } from '@/components/Skeleton';
import { StoryDetailClient } from '@/components/StoryDetailClient';
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

  return (
    <div className="flex flex-col gap-8">
      <BackButton />

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          {story.topics?.map((t) => <TopicBadge key={t} topic={t} />)}
          <span className="text-xs text-faint">{timeAgo(latestPublishedAt)}</span>
        </div>

        <h1 className="text-2xl font-bold leading-tight text-foreground md:text-3xl">
          {story.title}
        </h1>

        {story.summary && (
          <p className="text-base leading-relaxed text-muted">
            {story.summary}
          </p>
        )}

        <BiasBar counts={bias} showLabels />
      </div>

      <StoryDetailClient articles={story.articles} bias={bias} />
    </div>
  );
}
