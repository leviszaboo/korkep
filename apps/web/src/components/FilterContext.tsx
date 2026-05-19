'use client';

import { createContext, useContext, useTransition, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface FilterContextValue {
  isPending: boolean;
  optimisticTopic: string | null;
  optimisticSince: string;
  navigate: (href: string, opts?: { topic?: string | null; since?: string }) => void;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<{ topic: string | null; since: string } | null>(null);

  const currentTopic = searchParams.get('topic');
  const currentSince = searchParams.get('since') ?? 'today';

  const navigate = useCallback(
    (href: string, opts?: { topic?: string | null; since?: string }) => {
      setOptimistic({
        topic: opts?.topic !== undefined ? opts.topic : currentTopic,
        since: opts?.since !== undefined ? opts.since : currentSince,
      });
      startTransition(() => {
        router.push(href, { scroll: false });
      });
    },
    [router, currentTopic, currentSince],
  );

  const optimisticTopic = isPending && optimistic ? optimistic.topic : currentTopic;
  const optimisticSince = isPending && optimistic ? optimistic.since : currentSince;

  const value = useMemo(
    () => ({ isPending, optimisticTopic, optimisticSince, navigate }),
    [isPending, optimisticTopic, optimisticSince, navigate],
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilter() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilter must be used within FilterProvider');
  return ctx;
}
