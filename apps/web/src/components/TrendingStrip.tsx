import type { Story } from '@/lib/types';
import { StoryCard } from './StoryCard';

export function TrendingStrip({ stories }: { stories: Story[] }) {
  if (stories.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">Felkapott</h2>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {stories.slice(0, 6).map((story) => (
          <StoryCard key={story.id} story={story} />
        ))}
      </div>
    </section>
  );
}
