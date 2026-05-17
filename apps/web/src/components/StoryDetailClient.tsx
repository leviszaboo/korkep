'use client';

import { useState, useMemo } from 'react';
import type { Article, BiasRating, BiasCounts } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { BiasBadge } from './Badge';

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
      <GroupedCoverage grouped={grouped} />
    </div>
  );
}

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
  );
}

function HeadlineComparison({ grouped }: { grouped: Record<BiasGroup, Article[]> }) {
  const allSides: { key: BiasGroup; label: string; color: string; articles: Article[] }[] = [
    { key: 'left', label: 'Bal', color: 'text-bias-left', articles: grouped.left },
    { key: 'center', label: 'Közép', color: 'text-bias-center', articles: grouped.center },
    { key: 'right', label: 'Jobb', color: 'text-bias-right', articles: grouped.right },
  ];
  const sides = allSides.filter((s) => s.articles.length > 0);

  if (sides.length < 2) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-faint">
        Címlap-összehasonlítás
      </h3>
      <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-3">
        {sides.map(({ key, label, color, articles }, idx) => (
          <div
            key={key}
            className={`flex flex-col gap-2 py-3 ${
              idx < sides.length - 1 ? 'border-b lg:border-b-0 lg:border-r border-border' : ''
            } ${idx === 0 ? 'lg:pr-4' : idx === sides.length - 1 ? 'lg:pl-4' : 'lg:px-4'}`}
          >
            <span className={`text-[9px] font-bold uppercase tracking-[1.5px] ${color}`}>
              ● {label}
            </span>
            {articles.slice(0, 3).map((a, aIdx) => (
              <div key={a.id}>
                {aIdx > 0 && <div className="mb-2 h-px bg-border" />}
                <p className="text-[17px] font-bold leading-snug text-foreground">
                  {'"'}{a.title}{'"'}
                </p>
                <span className="mt-1 block text-xs text-faint">— {a.source.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CoverageTimeline({ articles }: { articles: Article[] }) {
  const withDate = articles
    .filter((a) => a.publishedAt)
    .sort((a, b) => new Date(a.publishedAt!).getTime() - new Date(b.publishedAt!).getTime());

  if (withDate.length < 2) return null;

  const first = new Date(withDate[0].publishedAt!).getTime();
  const last = new Date(withDate[withDate.length - 1].publishedAt!).getTime();
  const range = last - first || 1;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-faint">
        Timeline
      </h3>
      <div className="relative flex h-10 items-center">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {withDate.map((a) => {
          const pos = ((new Date(a.publishedAt!).getTime() - first) / range) * 100;
          const group = toBiasGroup(a.source.biasRating);
          const colors: Record<BiasGroup, string> = {
            left: 'bg-bias-left',
            center: 'bg-bias-center',
            right: 'bg-bias-right',
          };
          return (
            <div
              key={a.id}
              className="group absolute flex flex-col items-center"
              style={{ left: `${Math.min(Math.max(pos, 2), 98)}%` }}
            >
              <div className={`size-3 rounded-full ${colors[group]} border-2 border-background shadow-sm`} />
              <div className="absolute top-5 hidden whitespace-nowrap rounded bg-elevated px-2 py-1 text-[10px] text-muted shadow-sm group-hover:block">
                {a.source.name} &middot; {timeAgo(a.publishedAt!)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-faint">
        <span>First: {withDate[0].source.name}</span>
        <span>Latest: {withDate[withDate.length - 1].source.name}</span>
      </div>
    </div>
  );
}

function EntityMatrix({ articles }: { articles: Article[] }) {
  const [expanded, setExpanded] = useState(false);
  const entitySourceMap = new Map<string, Set<string>>();
  for (const a of articles) {
    if (a.entities) {
      for (const e of a.entities) {
        if (!entitySourceMap.has(e)) entitySourceMap.set(e, new Set());
        entitySourceMap.get(e)!.add(a.source.name);
      }
    }
  }

  if (entitySourceMap.size === 0) return null;

  const sourceNames = [...new Set(articles.map((a) => a.source.name))];
  const sorted = [...entitySourceMap.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 10);
  const totalSources = sourceNames.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">Szereplők</span>
        {sorted.map(([entity, sources]) => (
          <span
            key={entity}
            className="border border-border bg-surface px-2.5 py-0.5 text-xs text-foreground"
          >
            {entity} <span className="text-faint">{sources.size}/{totalSources}</span>
          </span>
        ))}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {expanded ? '− elrejtés' : '+ részletek ↓'}
        </button>
      </div>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-1.5 pr-3 text-left font-medium text-faint">Szereplő</th>
                {sourceNames.map((s) => (
                  <th key={s} className="pb-1.5 px-1.5 text-center font-medium text-faint whitespace-nowrap">
                    {s.length > 8 ? s.slice(0, 7) + '.' : s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(([entity, sources]) => (
                <tr key={entity} className="border-b border-border/50">
                  <td className="py-1.5 pr-3 font-medium text-foreground whitespace-nowrap">{entity}</td>
                  {sourceNames.map((s) => (
                    <td key={s} className="py-1.5 px-1.5 text-center">
                      {sources.has(s) ? (
                        <span className="inline-block size-2 rounded-full bg-accent" />
                      ) : (
                        <span className="inline-block size-2 rounded-full bg-elevated" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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

function GroupedCoverage({ grouped }: { grouped: Record<BiasGroup, Article[]> }) {
  const allSides: { key: BiasGroup; label: string; color: string; bgColor: string; articles: Article[] }[] = [
    { key: 'left', label: 'Bal', color: 'bg-bias-left', bgColor: 'border-bias-left/30', articles: grouped.left },
    { key: 'center', label: 'Közép', color: 'bg-bias-center', bgColor: 'border-bias-center/30', articles: grouped.center },
    { key: 'right', label: 'Jobb', color: 'bg-bias-right', bgColor: 'border-bias-right/30', articles: grouped.right },
  ];
  const sides = allSides.filter((s) => s.articles.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-faint">
        Teljes lefedettség
      </h2>
      {sides.map(({ key, label, color, bgColor, articles }) => (
        <BiasSection
          key={key}
          label={label}
          color={color}
          bgColor={bgColor}
          articles={articles}
        />
      ))}
    </div>
  );
}

function BiasSection({
  label,
  color,
  bgColor,
  articles,
}: {
  label: string;
  color: string;
  bgColor: string;
  articles: Article[];
}) {
  const bySource = new Map<string, Article[]>();
  for (const a of articles) {
    const key = a.source.slug;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(a);
  }

  return (
    <div className={`border ${bgColor} p-3`}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`size-2.5 rounded-full ${color}`} />
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <span className="text-xs text-faint">({articles.length})</span>
      </div>
      <div className="flex flex-col gap-1">
        {[...bySource.entries()].map(([slug, sourceArticles]) => (
          <SourceArticleGroup key={slug} articles={sourceArticles} />
        ))}
      </div>
    </div>
  );
}

function SourceArticleGroup({ articles }: { articles: Article[] }) {
  const [expanded, setExpanded] = useState(false);
  const primary = articles[0];
  const extras = articles.slice(1);

  return (
    <div className="flex flex-col">
      <CompactArticleRow article={primary} extraCount={extras.length} onExpand={extras.length > 0 ? () => setExpanded(!expanded) : undefined} />
      {expanded && extras.map((a) => (
        <CompactArticleRow key={a.id} article={a} extraCount={0} indent />
      ))}
    </div>
  );
}

function CompactArticleRow({
  article,
  extraCount,
  onExpand,
  indent = false,
}: {
  article: Article;
  extraCount: number;
  onExpand?: () => void;
  indent?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-elevated/50 ${indent ? 'ml-7' : ''}`}>
      <SourceInitial name={article.source.name} logoUrl={article.source.logoUrl} />
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 min-w-0 text-sm leading-snug text-foreground hover:text-accent transition-colors truncate"
      >
        {article.title}
      </a>
      <div className="flex items-center gap-2 shrink-0">
        {extraCount > 0 && (
          <button
            onClick={(e) => { e.preventDefault(); onExpand?.(); }}
            className="text-[10px] font-medium text-accent hover:underline"
          >
            +{extraCount} more
          </button>
        )}
        <span className="text-[10px] text-faint whitespace-nowrap">
          {article.publishedAt ? timeAgo(article.publishedAt) : ''}
        </span>
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-faint hover:text-accent"
        >
          <ExternalLinkIcon />
        </a>
      </div>
    </div>
  );
}

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
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-current">
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
