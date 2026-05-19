export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { getSources } from '@/lib/api';
import { BiasBadge } from '@/components/Badge';
import { FolkDivider } from '@/components/FolkPattern';
import { BiasSpectrum } from '@/components/BiasSpectrum';

export const metadata: Metadata = {
  title: 'Sources',
  description: 'Hungarian news outlets tracked by Körkép.',
};

const biasOrder: Record<string, number> = {
  left: 0,
  'center-left': 1,
  center: 2,
  'center-right': 3,
  right: 4,
};

export default async function SourcesPage() {
  const { data: sources } = await getSources();

  const sorted = [...sources].sort(
    (a, b) => (biasOrder[a.biasRating] ?? 2) - (biasOrder[b.biasRating] ?? 2),
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <h1 className="font-serif text-2xl font-semibold text-foreground">Sources</h1>
        <p className="mt-1.5 text-sm text-muted">
          {sources.length} Hungarian news outlets
        </p>
        <Link
          href="/sources/compare"
          className="mt-2 inline-flex text-xs font-medium text-accent transition-colors hover:underline"
        >
          Források összehasonlítása →
        </Link>
      </div>

      <FolkDivider />

      <BiasSpectrum sources={sources} />

      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((source) => (
          <a
            key={source.id}
            id={`source-${source.slug}`}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between border-b border-border p-4 transition-all hover:bg-surface"
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
