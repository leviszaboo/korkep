import type { BiasRating } from '@/lib/types';

const biasStyles: Record<string, string> = {
  left: 'bg-bias-left-bg text-bias-left',
  'center-left': 'bg-bias-left-bg text-bias-left',
  center: 'bg-bias-center-bg text-bias-center',
  'center-right': 'bg-bias-right-bg text-bias-right',
  right: 'bg-bias-right-bg text-bias-right',
};

export function BiasBadge({ rating }: { rating: BiasRating }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${biasStyles[rating] ?? ''}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {rating.replace('-', '‑')}
    </span>
  );
}

export function TopicBadge({ topic }: { topic: string }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[1.5px] text-accent">
      {topic}
    </span>
  );
}

export function FreshBadge() {
  return (
    <span className="text-[10px] font-semibold text-fresh">
      ● Friss
    </span>
  );
}
