'use client';

import { useState, useEffect } from 'react';
import type { Source, ComparedStory } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const biasColors: Record<string, string> = {
  left: 'border-l-bias-left bg-bias-left-bg/30',
  'center-left': 'border-l-bias-left bg-bias-left-bg/30',
  center: 'border-l-bias-center bg-bias-center-bg/30',
  'center-right': 'border-l-bias-right bg-bias-right-bg/30',
  right: 'border-l-bias-right bg-bias-right-bg/30',
};

export function SourceCompare({ sources }: { sources: Source[] }) {
  const [slugA, setSlugA] = useState('');
  const [slugB, setSlugB] = useState('');
  const [stories, setStories] = useState<ComparedStory[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!slugA || !slugB || slugA === slugB) {
      setStories([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    fetch(`${API_URL}/api/sources/compare?a=${encodeURIComponent(slugA)}&b=${encodeURIComponent(slugB)}`)
      .then((r) => r.json())
      .then((data: { data: ComparedStory[] }) => {
        setStories(data.data);
        setSearched(true);
      })
      .catch(() => setStories([]))
      .finally(() => setLoading(false));
  }, [slugA, slugB]);

  const sourceA = sources.find((s) => s.slug === slugA);
  const sourceB = sources.find((s) => s.slug === slugB);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <SourcePicker
          label="Forrás A"
          sources={sources}
          value={slugA}
          onChange={setSlugA}
          exclude={slugB}
        />
        <SourcePicker
          label="Forrás B"
          sources={sources}
          value={slugB}
          onChange={setSlugB}
          exclude={slugA}
        />
      </div>

      {loading && (
        <div className="py-8 text-center text-sm text-muted">Betöltés...</div>
      )}

      {searched && !loading && stories.length === 0 && (
        <div className="py-8 text-center text-sm text-muted">
          Ezek a források nem fedték le ugyanazokat a történeteket.
        </div>
      )}

      {stories.length > 0 && sourceA && sourceB && (
        <div className="flex flex-col gap-3">
          <h2 className="text-[9px] font-bold uppercase tracking-[2px] text-faint">
            {stories.length} közös történet
          </h2>
          <div className="flex flex-col gap-4">
            {stories.map((story) => (
              <div key={story.storyId} className="flex flex-col gap-2 rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  {story.storyTopics?.map((t) => (
                    <span key={t} className="text-[9px] font-bold uppercase tracking-[1.5px] text-accent">{t}</span>
                  ))}
                  <span className="text-[10px] text-faint">{timeAgo(story.latestPublishedAt)}</span>
                </div>
                <h3 className="font-serif text-lg font-bold leading-snug text-foreground">
                  {story.storyTitle}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className={`rounded border-l-[3px] ${biasColors[story.sourceA.biasRating] ?? ''} px-3 py-2`}>
                    <span className="text-[10px] font-semibold text-muted">{sourceA.name}</span>
                    <p className="font-serif text-sm italic text-foreground">&ldquo;{story.sourceA.title}&rdquo;</p>
                  </div>
                  <div className={`rounded border-l-[3px] ${biasColors[story.sourceB.biasRating] ?? ''} px-3 py-2`}>
                    <span className="text-[10px] font-semibold text-muted">{sourceB.name}</span>
                    <p className="font-serif text-sm italic text-foreground">&ldquo;{story.sourceB.title}&rdquo;</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SourcePicker({
  label,
  sources,
  value,
  onChange,
  exclude,
}: {
  label: string;
  sources: Source[];
  value: string;
  onChange: (slug: string) => void;
  exclude: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-faint">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-base px-3 py-2 text-sm text-foreground focus:border-border-focus focus:outline-none"
      >
        <option value="">Válassz forrást...</option>
        {sources
          .filter((s) => s.slug !== exclude)
          .map((s) => (
            <option key={s.slug} value={s.slug}>{s.name}</option>
          ))}
      </select>
    </div>
  );
}
