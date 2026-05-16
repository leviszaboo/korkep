'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useRef, useState } from 'react';

const navItems = [
  { href: '/', label: 'Stories', icon: NewspaperIcon },
  { href: '/sources', label: 'Sources', icon: LayersIcon },
];

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const isSearchPage = pathname === '/search';
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const showSearch = searchOpen || isSearchPage;

  function openSearch() {
    setSearchOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery('');
    if (isSearchPage) router.push('/');
  }

  function handleInput(value: string) {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (value.trim()) {
        router.push(`/search?q=${encodeURIComponent(value.trim())}`);
      }
    }, 400);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') closeSearch();
    if (e.key === 'Enter' && query.trim()) {
      if (timerRef.current) clearTimeout(timerRef.current);
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-base/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <FlowerLogo />
          <span className="text-lg font-semibold tracking-tight text-foreground">
            Körkép
          </span>
        </Link>

        <div className="flex items-center gap-1">
          {showSearch ? (
            <div className="flex items-center gap-2">
              <div className="relative">
                <SearchNavIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => handleInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={() => { if (!query) closeSearch(); }}
                  placeholder="Search stories..."
                  className="w-48 rounded-lg border border-border bg-base py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-faint transition-all focus:w-64 focus:border-border-focus focus:outline-none sm:w-56"
                />
              </div>
              <button onClick={closeSearch} className="rounded-md p-1.5 text-muted hover:text-foreground transition-colors">
                <CloseIcon />
              </button>
            </div>
          ) : (
            <>
              <nav className="flex items-center gap-0.5">
                {navItems.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? 'text-foreground bg-surface font-medium'
                          : 'text-muted hover:text-foreground hover:bg-surface'
                      }`}
                    >
                      <item.icon />
                      <span className="hidden sm:inline">{item.label}</span>
                    </Link>
                  );
                })}
                <button
                  onClick={openSearch}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground hover:bg-surface"
                >
                  <SearchNavIcon />
                  <span className="hidden sm:inline">Search</span>
                </button>
              </nav>
              <div className="ml-1 border-l border-border pl-1">
                <ThemeToggleInline />
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function ThemeToggleInline() {
  const [dark, setDark] = useState<boolean | null>(null);

  if (dark === null) {
    if (typeof document !== 'undefined') {
      setDark(document.documentElement.dataset.theme === 'dark');
    }
    return <span className="block size-[18px]" />;
  }

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="rounded-md p-2 text-muted transition-colors hover:text-foreground hover:bg-surface"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function FlowerLogo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <g transform="translate(16,16)">
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <path
            key={`o${a}`}
            d="M0,-4 C3.5,-6.5 3.5,-11 0,-14 C-3.5,-11 -3.5,-6.5 0,-4Z"
            className="fill-accent"
            opacity={0.8}
            transform={`rotate(${a})`}
          />
        ))}
        {[30, 90, 150, 210, 270, 330].map((a) => (
          <path
            key={`i${a}`}
            d="M0,-2.5 C2,-4.5 2,-8 0,-10 C-2,-8 -2,-4.5 0,-2.5Z"
            className="fill-accent-hover"
            opacity={0.5}
            transform={`rotate(${a})`}
          />
        ))}
        <circle r="3" className="fill-accent-hover" />
        <circle r="1.5" className="fill-accent" />
      </g>
    </svg>
  );
}

function NewspaperIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <line x1="5" y1="5.5" x2="11" y2="5.5" />
      <line x1="5" y1="8" x2="8" y2="8" />
      <line x1="5" y1="10.5" x2="11" y2="10.5" />
      <rect x="9.5" y="7.5" width="1.5" height="2" rx="0.3" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2L2 5.5L8 9L14 5.5L8 2Z" />
      <path d="M2 8L8 11.5L14 8" />
      <path d="M2 10.5L8 14L14 10.5" />
    </svg>
  );
}

function SearchNavIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className={className}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L13.5 13.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 4L12 12M12 4L4 12" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
