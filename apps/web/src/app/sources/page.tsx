export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { getSources } from '@/lib/api';
import { BiasBadge } from '@/components/Badge';

export const metadata: Metadata = {
  title: 'Sources',
  description: 'Hungarian news outlets tracked by Körkép.',
};

function FolkDivider() {
  return (
    <div className="flex items-center gap-4" aria-hidden="true">
      <div className="h-px flex-1 bg-border" />
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <g transform="translate(12,12)" fill="var(--ac)" opacity="0.3">
          {[0, 90, 180, 270].map((a) => (
            <path key={a} d="M0,-2 C1.8,-4 1.8,-7 0,-9 C-1.8,-7 -1.8,-4 0,-2Z" transform={`rotate(${a})`} />
          ))}
          <circle r="1.5" />
        </g>
      </svg>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export default async function SourcesPage() {
  const { data: sources } = await getSources();

  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-foreground">Sources</h1>
        <p className="mt-1.5 text-sm text-muted">
          {sources.length} Hungarian news outlets
        </p>
      </div>

      <FolkDivider />

      <div className="grid gap-3 sm:grid-cols-2">
        {sources.map((source) => (
          <a
            key={source.id}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-border/60 bg-surface/50 p-4 transition-all hover:bg-surface hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <SourceLogo name={source.name} logoUrl={source.logoUrl} />
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2.5">
                  <span className="text-base font-medium text-foreground group-hover:text-accent transition-colors">
                    {source.name}
                  </span>
                  <BiasBadge rating={source.biasRating} />
                </div>
                <span className="text-xs text-faint">{source.url.replace(/^https?:\/\//, '')}</span>
              </div>
            </div>

            <span className="text-sm tabular-nums text-muted">
              {source.articleCount.toLocaleString('hu-HU')}
              <span className="ml-1 text-faint">articles</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function SourceLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className="size-9 shrink-0 rounded-full bg-elevated object-cover"
      />
    );
  }
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-semibold text-muted">
      {name.slice(0, 2)}
    </span>
  );
}
