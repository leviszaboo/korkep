import { Suspense } from 'react';
import { FilterShell } from '@/components/FilterShell';
import { MainStoriesClient } from '@/components/MainStoriesClient';

export default function HomePage() {
  return (
    <FilterShell>
      <Suspense>
        <MainStoriesClient />
      </Suspense>
    </FilterShell>
  );
}
