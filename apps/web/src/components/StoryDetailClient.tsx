'use client';

import { useState, useMemo } from 'react';
import type { Article, BiasRating, BiasCounts } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

type BiasGroup = 'left' | 'center' | 'right';

function toBiasGroup(rating: BiasRating): BiasGroup {
  if (rating === 'left' || rating === 'center-left') return 'left';
  if (rating === 'center') return 'center';
  return 'right';
}

interface Props {
  articles: Article[];
  bias: BiasCounts;
}

export function StoryDetailClient({ articles, bias }: Props) {
  const [hiddenGroups, setHiddenGroups] = useState<Set<BiasGroup>>(new Set());

  const filtered = useMemo(
    () => articles.filter((a) => !hiddenGroups.has(toBiasGroup(a.source.biasRating))),
    [articles, hiddenGroups],
  );

  const grouped = useMemo(() => {
    const map: Record<BiasGroup, Article[]> = { left: [], center: [], right: [] };
    for (const a of filtered) {
      map[toBiasGroup(a.source.biasRating)].push(a);
    }
    return map;
  }, [filtered]);

  const toggleGroup = (g: BiasGroup) => {
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <BiasFilterBar hiddenGroups={hiddenGroups} toggleGroup={toggleGroup} bias={bias} />
      <HeadlineComparison grouped={grouped} />
      <CoverageTimeline articles={filtered} />
      <EntityMatrix articles={filtered} />
      <LocationContext articles={filtered} />
      <AllArticles articles={filtered} />
    </div>
  );
}

/* ── Sticky Filter Bar ─────────────────────────────────────────── */

function BiasFilterBar({
  hiddenGroups,
  toggleGroup,
  bias,
}: {
  hiddenGroups: Set<BiasGroup>;
  toggleGroup: (g: BiasGroup) => void;
  bias: BiasCounts;
}) {
  const groups: { key: BiasGroup; label: string; count: number; color: string }[] = [
    { key: 'left', label: 'Bal', count: bias.left, color: 'bg-bias-left' },
    { key: 'center', label: 'Közép', count: bias.center, color: 'bg-bias-center' },
    { key: 'right', label: 'Jobb', count: bias.right, color: 'bg-bias-right' },
  ];

  return (
    <div className="sticky top-14 z-40 -mx-4 bg-base/80 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-faint">Szűrő:</span>
        {groups.map(({ key, label, count, color }) =>
          count > 0 ? (
            <button
              key={key}
              onClick={() => toggleGroup(key)}
              className={`inline-flex items-center gap-1.5 border px-3 py-1 text-xs font-medium transition-all ${
                hiddenGroups.has(key)
                  ? 'border-border bg-elevated text-faint line-through opacity-50'
                  : 'border-border bg-base text-foreground'
              }`}
            >
              <span className={`size-2 rounded-full ${color}`} />
              {label} ({count})
            </button>
          ) : null,
        )}
      </div>
    </div>
  );
}

/* ── VS Hero Headline Comparison ───────────────────────────────── */

function HeadlineComparison({ grouped }: { grouped: Record<BiasGroup, Article[]> }) {
  const left = grouped.left;
  const center = grouped.center;
  const right = grouped.right;

  const hasLeft = left.length > 0;
  const hasRight = right.length > 0;
  const hasCenter = center.length > 0;

  if (!hasLeft && !hasRight) return null;
  if ((hasLeft ? 1 : 0) + (hasCenter ? 1 : 0) + (hasRight ? 1 : 0) < 2) return null;

  if (hasLeft && hasRight) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-[9px] font-bold uppercase tracking-[2px] text-faint">
          Bal vs. Jobb — Ugyanaz a történet
        </h3>
        <div className="grid grid-cols-1 overflow-hidden rounded-lg sm:grid-cols-[1fr_auto_1fr]">
          <VsSide
            label="Bal oldal"
            articles={left}
            colorClass="text-bias-left"
            bgClass="bg-bias-left-bg/50"
            barClass="bg-bias-left"
          />
          <div className="hidden sm:flex w-9 items-center justify-center border-x border-border bg-base">
            <span className="font-serif text-xs font-bold text-faint [writing-mode:vertical-rl] tracking-[3px]">
              VS
            </span>
          </div>
          <div className="flex items-center justify-center border-y border-border bg-base py-1 sm:hidden">
            <span className="font-serif text-xs font-bold text-faint tracking-[3px]">VS</span>
          </div>
          <VsSide
            label="Jobb oldal"
            articles={right}
            colorClass="text-bias-right"
            bgClass="bg-bias-right-bg/50"
            barClass="bg-bias-right"
          />
        </div>
        {hasCenter && <CenterStrip articles={center} />}
      </div>
    );
  }

  const sides = [
    { key: 'left' as const, label: 'Bal', color: 'text-bias-left', articles: left },
    { key: 'center' as const, label: 'Közép', color: 'text-bias-center', articles: center },
    { key: 'right' as const, label: 'Jobb', color: 'text-bias-right', articles: right },
  ].filter((s) => s.articles.length > 0);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[9px] font-bold uppercase tracking-[2px] text-faint">
        Címlap-összehasonlítás
      </h3>
      <div className="flex flex-col gap-3">
        {sides.map(({ key, label, color, articles: sideArticles }) => (
          <div key={key} className="flex gap-0">
            <div className={`w-1 shrink-0 rounded ${color.replace('text-', 'bg-')}`} />
            <div className="flex flex-col gap-1 px-4 py-2">
              <span className={`text-[8px] font-bold uppercase tracking-[1.5px] ${color}`}>● {label}</span>
              <p className="font-serif text-[17px] font-bold italic leading-snug text-foreground">
                &ldquo;{sideArticles[0].title}&rdquo;
              </p>
              <span className="text-xs text-faint">— {sideArticles[0].source.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VsSide({
  label,
  articles,
  colorClass,
  bgClass,
  barClass,
}: {
  label: string;
  articles: Article[];
  colorClass: string;
  bgClass: string;
  barClass: string;
}) {
  const sourceNames = [...new Set(articles.map((a) => a.source.name))].slice(0, 3).join(' · ');

  return (
    <div className={`flex flex-col gap-2 p-4 ${bgClass}`}>
      <span className={`text-[8px] font-bold uppercase tracking-[1.5px] ${colorClass}`}>
        ● {label}
      </span>
      <p className="font-serif text-base font-bold leading-snug text-foreground">
        &ldquo;{articles[0].title}&rdquo;
      </p>
      <span className="text-[10px] text-faint">{sourceNames}</span>
      <div className="mt-auto flex items-center gap-1.5">
        <div className={`h-[3px] flex-1 rounded ${barClass}`} />
        <span className={`text-xs font-bold ${colorClass}`}>{articles.length}</span>
      </div>
    </div>
  );
}

function CenterStrip({ articles }: { articles: Article[] }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-bias-center-bg/50 px-3 py-2.5">
      <div className="h-6 w-1 shrink-0 rounded bg-bias-center" />
      <div className="min-w-0 flex-1">
        <span className="text-[8px] font-bold uppercase tracking-[1.5px] text-bias-center">
          ● Közép ({articles.length})
        </span>
        <p className="truncate font-serif text-sm italic text-muted">
          &ldquo;{articles[0].title}&rdquo; — {articles[0].source.name}
        </p>
      </div>
    </div>
  );
}

/* ── Coverage Timeline ─────────────────────────────────────────── */

function CoverageTimeline({ articles }: { articles: Article[] }) {
  const withDate = articles
    .filter((a) => a.publishedAt)
    .sort((a, b) => new Date(a.publishedAt!).getTime() - new Date(b.publishedAt!).getTime());

  if (withDate.length < 2) return null;

  const first = new Date(withDate[0].publishedAt!).getTime();
  const last = new Date(withDate[withDate.length - 1].publishedAt!).getTime();
  const range = last - first || 1;

  const biasColor: Record<BiasGroup, string> = {
    left: 'bg-bias-left',
    center: 'bg-bias-center',
    right: 'bg-bias-right',
  };
  const biasTextColor: Record<BiasGroup, string> = {
    left: 'text-bias-left',
    center: 'text-bias-center',
    right: 'text-bias-right',
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[9px] font-bold uppercase tracking-[2px] text-faint">
        Ki volt az első?
      </h3>
      <div className="relative flex h-12 items-start pt-1">
        <div className="absolute left-0 right-0 top-[7px] h-0.5 bg-border" />
        {withDate.map((a) => {
          const pos = ((new Date(a.publishedAt!).getTime() - first) / range) * 100;
          const group = toBiasGroup(a.source.biasRating);
          return (
            <div
              key={a.id}
              className="group absolute flex flex-col items-center"
              style={{ left: `${Math.min(Math.max(pos, 2), 98)}%`, transform: 'translateX(-50%)' }}
            >
              <div className={`size-3 rounded-full ${biasColor[group]} border-2 border-base shadow-sm`} />
              <span className={`mt-1.5 text-[8px] font-semibold ${biasTextColor[group]} whitespace-nowrap`}>
                {a.source.name.length > 8 ? a.source.name.slice(0, 7) + '.' : a.source.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Entity Rows with Mini Bias-Bars ───────────────────────────── */

function EntityMatrix({ articles }: { articles: Article[] }) {
  const [showAll, setShowAll] = useState(false);

  const entityBiasMap = new Map<string, { left: number; center: number; right: number }>();
  for (const a of articles) {
    if (a.entities) {
      const group = toBiasGroup(a.source.biasRating);
      for (const e of a.entities) {
        if (!entityBiasMap.has(e)) entityBiasMap.set(e, { left: 0, center: 0, right: 0 });
        entityBiasMap.get(e)![group]++;
      }
    }
  }

  if (entityBiasMap.size === 0) return null;

  const totalSources = new Set(articles.map((a) => a.source.name)).size;
  const sorted = [...entityBiasMap.entries()].sort((a, b) => {
    const aTotal = a[1].left + a[1].center + a[1].right;
    const bTotal = b[1].left + b[1].center + b[1].right;
    return bTotal - aTotal;
  });

  const visible = showAll ? sorted : sorted.slice(0, 5);
  const hasMore = sorted.length > 5;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[9px] font-bold uppercase tracking-[2px] text-faint">
        Ki kit említ?
      </h3>
      <div className="flex flex-col gap-2">
        {visible.map(([entity, counts]) => {
          const entityTotal = counts.left + counts.center + counts.right;
          return (
            <div key={entity} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-sm font-semibold text-foreground">
                {entity}
              </span>
              <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
                {counts.left > 0 && (
                  <div className="bg-bias-left" style={{ width: `${(counts.left / entityTotal) * 100}%` }} />
                )}
                {counts.center > 0 && (
                  <div className="bg-bias-center" style={{ width: `${(counts.center / entityTotal) * 100}%` }} />
                )}
                {counts.right > 0 && (
                  <div className="bg-bias-right" style={{ width: `${(counts.right / entityTotal) * 100}%` }} />
                )}
              </div>
              <span className="w-8 shrink-0 text-right text-[10px] text-faint">
                {entityTotal}/{totalSources}
              </span>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {showAll ? '− kevesebb' : `+ még ${sorted.length - 5}`}
        </button>
      )}
    </div>
  );
}

/* ── Location Context ──────────────────────────────────────────── */

function LocationContext({ articles }: { articles: Article[] }) {
  const locations = [...new Set(articles.map((a) => a.location).filter(Boolean))] as string[];
  if (locations.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <LocationIcon />
      <span className="text-xs text-muted">{locations.join(', ')}</span>
    </div>
  );
}

/* ── All Articles List ─────────────────────────────────────────── */

function AllArticles({ articles }: { articles: Article[] }) {
  const sorted = [...articles].sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  const biasStyles: Record<BiasGroup, { border: string; bg: string }> = {
    left: { border: 'border-l-bias-left', bg: 'bg-bias-left-bg/30' },
    center: { border: 'border-l-bias-center', bg: 'bg-bias-center-bg/30' },
    right: { border: 'border-l-bias-right', bg: 'bg-bias-right-bg/30' },
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[9px] font-bold uppercase tracking-[2px] text-faint">
        Összes cikk
      </h3>
      <div className="flex flex-col gap-1.5">
        {sorted.map((a) => {
          const group = toBiasGroup(a.source.biasRating);
          const styles = biasStyles[group];
          return (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2.5 rounded border-l-[3px] ${styles.border} ${styles.bg} px-3 py-2 transition-colors hover:bg-elevated/50`}
            >
              <SourceInitial name={a.source.name} logoUrl={a.source.logoUrl} />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {a.title}
              </span>
              <span className="shrink-0 text-[10px] text-faint whitespace-nowrap">
                {a.publishedAt ? timeAgo(a.publishedAt) : ''}
              </span>
              <ExternalLinkIcon />
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* ── Shared Components ─────────────────────────────────────────── */

function SourceInitial({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) {
    return (
      <span className="relative flex size-5 shrink-0 items-center justify-center rounded-full bg-elevated text-[10px] font-semibold text-muted">
        <img src={logoUrl} alt="" className="absolute inset-0 size-5 rounded-full object-cover" />
        {name.slice(0, 1)}
      </span>
    );
  }
  return (
    <span className="flex size-5 items-center justify-center rounded-full bg-elevated text-[10px] font-semibold text-muted">
      {name.slice(0, 2)}
    </span>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0 text-faint">
      <path
        d="M4.5 11.5L11.5 4.5M11.5 4.5H5.5M11.5 4.5V10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
      <path d="M8 14s5-4.5 5-7.5a5 5 0 1 0-10 0C3 9.5 8 14 8 14z" />
      <circle cx="8" cy="6.5" r="1.5" />
    </svg>
  );
}
