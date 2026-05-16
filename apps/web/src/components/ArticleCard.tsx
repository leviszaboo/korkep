import type { Article } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { BiasBadge } from './Badge';

export function ArticleCard({ article }: { article: Article }) {
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-lg border border-border bg-surface transition-all hover:border-border-strong hover:shadow-md"
    >
      {article.imageUrl && (
        <div className="relative aspect-[16/9] overflow-hidden bg-elevated">
          <img
            src={article.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      )}

      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SourceInitial name={article.source.name} logoUrl={article.source.logoUrl} />
            <span className="text-sm font-medium text-foreground">
              {article.source.name}
            </span>
            <BiasBadge rating={article.source.biasRating} />
          </div>
          <ArrowUpRight />
        </div>

        <h3 className="text-base font-medium leading-snug text-foreground group-hover:text-accent transition-colors">
          {article.title}
        </h3>

        <p className="text-xs text-faint">
          {article.author && (
            <>
              {article.author}
              <span className="mx-1.5">&middot;</span>
            </>
          )}
          {article.publishedAt ? timeAgo(article.publishedAt) : 'Unknown date'}
        </p>
      </div>
    </a>
  );
}

function SourceInitial({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) {
    return (
      <span className="relative flex size-5 shrink-0 items-center justify-center rounded-full bg-elevated text-[10px] font-semibold text-muted">
        <img
          src={logoUrl}
          alt=""
          className="absolute inset-0 size-5 rounded-full object-cover"
        />
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

function ArrowUpRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0 text-faint group-hover:text-accent transition-colors"
    >
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
