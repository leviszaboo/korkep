'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useEffect } from 'react';

export function SearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const currentQuery = searchParams.get('q') ?? '';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleChange(value: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (value.trim()) {
        router.push(`/search?q=${encodeURIComponent(value.trim())}`);
      } else {
        router.push('/search');
      }
    }, 350);
  }

  return (
    <div className="relative">
      <SearchIcon />
      <input
        ref={inputRef}
        type="text"
        defaultValue={currentQuery}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search stories..."
        className="w-full rounded-lg border border-border bg-base py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-faint transition-colors focus:border-border-focus focus:outline-none"
      />
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
    >
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
