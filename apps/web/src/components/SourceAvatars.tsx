'use client';

import { useState } from 'react';
import type { StorySource } from '@/lib/types';

const biasRingColor: Record<string, string> = {
  left: 'ring-bias-left/40',
  'center-left': 'ring-bias-left/40',
  center: 'ring-bias-center/40',
  'center-right': 'ring-bias-right/40',
  right: 'ring-bias-right/40',
};

function Avatar({ source }: { source: StorySource }) {
  const [failed, setFailed] = useState(false);
  const initials = source.name.slice(0, 2);
  const ring = biasRingColor[source.biasRating] ?? '';

  if (source.logoUrl && !failed) {
    return (
      <img
        src={source.logoUrl}
        alt={source.name}
        title={source.name}
        onError={() => setFailed(true)}
        className={`size-6 rounded-full bg-elevated object-cover ring-2 ring-surface ${ring}`}
      />
    );
  }

  return (
    <span
      title={source.name}
      className={`flex size-6 items-center justify-center rounded-full bg-elevated text-[10px] font-semibold text-muted ring-2 ring-surface ${ring}`}
    >
      {initials}
    </span>
  );
}

export function SourceAvatars({ sources, max = 4 }: { sources: StorySource[]; max?: number }) {
  if (sources.length === 0) return null;

  const visible = sources.slice(0, max);
  const overflow = sources.length - max;

  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((s) => (
        <Avatar key={s.slug} source={s} />
      ))}
      {overflow > 0 && (
        <span className="flex size-6 items-center justify-center rounded-full bg-elevated text-[10px] font-medium text-muted ring-2 ring-surface">
          +{overflow}
        </span>
      )}
    </div>
  );
}
