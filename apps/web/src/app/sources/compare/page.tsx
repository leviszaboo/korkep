export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { getSources } from '@/lib/api';
import { BackButton } from '@/components/BackButton';
import { SourceCompare } from '@/components/SourceCompare';

export const metadata: Metadata = {
  title: 'Compare Sources',
  description: 'Compare how two news sources cover the same stories.',
};

export default async function ComparePage() {
  const { data: sources } = await getSources();

  return (
    <div className="flex flex-col gap-8">
      <BackButton />

      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-bold text-foreground">
          Források összehasonlítása
        </h1>
        <p className="text-sm text-muted">
          Válassz két forrást és nézd meg, hogyan számoltak be ugyanazokról a történetekről.
        </p>
      </div>

      <SourceCompare sources={sources} />
    </div>
  );
}
