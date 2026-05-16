'use client';

import { useRouter } from 'next/navigation';

export function BackButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.back()}
      className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M10 4L6 8L10 12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Back
    </button>
  );
}
