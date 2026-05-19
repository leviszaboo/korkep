'use client';

import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { RefObject } from 'react';
import { useRef, useState, useEffect } from 'react';
import { TulipLogo } from './FolkPattern';

const navItems = [
  { href: '/', label: 'Stories', icon: NewspaperIcon },
  { href: '/sources', label: 'Sources', icon: LayersIcon },
];

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isSearchPage = pathname === '/search';
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const urlQuery = searchParams.get('q') ?? '';
  useEffect(() => {
    if (isSearchPage && urlQuery) {
      setSearchOpen(true);
      setQuery(urlQuery);
    }
  }, [isSearchPage, urlQuery]);

  const showSearch = searchOpen || isSearchPage;

  function openSearch() {
    setSearchOpen(true);
    setTimeout(() => {
      const desktop = window.matchMedia('(min-width: 640px)').matches;
      const input = desktop ? desktopInputRef.current : mobileInputRef.current;
      input?.focus({ preventScroll: true });
    }, 0);
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

  function renderSearchForm(ref: RefObject<HTMLInputElement | null>) {
    return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <SearchNavIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          ref={ref}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (!query && !isSearchPage) closeSearch(); }}
          placeholder="Search stories..."
          className="w-full rounded-lg border border-border bg-base py-2 pl-10 pr-3 text-base text-foreground placeholder:text-faint transition-all focus:border-border-focus focus:outline-none sm:w-56 sm:py-1.5 sm:pl-8 sm:text-sm sm:focus:w-64"
        />
      </div>
      <button onClick={closeSearch} className="rounded-md p-2 text-muted transition-colors hover:text-foreground sm:p-1.5" aria-label="Close search">
        <CloseIcon />
      </button>
    </div>
    );
  }

  return (
    <header className="sticky top-0 z-50 border-b-2 border-foreground bg-base/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <TulipLogo />
          <span className="font-serif text-lg font-bold tracking-tight text-foreground">
            Körkép
          </span>
        </Link>

        <HeaderInfo />

        <div className="flex items-center gap-1">
          {showSearch ? (
            <div className="hidden sm:block">{renderSearchForm(desktopInputRef)}</div>
          ) : (
            <>
              <nav className="hidden items-center gap-0.5 sm:flex">
                {navItems.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? 'text-foreground font-semibold'
                          : 'text-muted hover:text-foreground'
                      }`}
                    >
                      <item.icon />
                      <span className="hidden sm:inline">{item.label}</span>
                    </Link>
                  );
                })}
                <button
                  onClick={openSearch}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
                >
                  <SearchNavIcon />
                  <span className="hidden sm:inline">Search</span>
                </button>
              </nav>
              <div className="ml-2 border-l border-border pl-2">
                <ThemeToggleInline />
              </div>
            </>
          )}
        </div>
      </div>
      {showSearch && (
        <div className="border-t border-border px-4 py-2 sm:hidden">
          {renderSearchForm(mobileInputRef)}
        </div>
      )}
    </header>
  );
}

function HeaderInfo() {
  const [time, setTime] = useState('');
  const [rates, setRates] = useState<{ eur: string; usd: string; chf: string } | null>(null);

  useEffect(() => {
    function tick() {
      const now = new Date();
      setTime(now.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }));
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    async function fetchRates() {
      try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/HUF');
        if (!res.ok) return;
        const data = await res.json();
        setRates({
          eur: (1 / data.rates.EUR).toFixed(1),
          usd: (1 / data.rates.USD).toFixed(1),
          chf: (1 / data.rates.CHF).toFixed(1),
        });
      } catch {}
    }
    fetchRates();
  }, []);

  const dateStr = new Date().toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  return (
    <div className="min-w-0 flex flex-1 items-center justify-center px-3 text-center text-[11px] text-muted sm:text-xs md:gap-3">
      <span className="truncate">{dateStr}</span>
      {time && <span className="hidden md:inline">{time}</span>}
      {rates && (
        <>
          <span className="hidden h-3 w-px bg-border md:inline" />
          <span className="hidden md:inline">EUR/HUF {rates.eur}</span>
          <span className="hidden md:inline">USD/HUF {rates.usd}</span>
          <span className="hidden md:inline">CHF/HUF {rates.chf}</span>
        </>
      )}
    </div>
  );
}

function ThemeToggleInline() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const themeParam = searchParams.get('theme');
    if (themeParam === 'dark' || themeParam === 'light') {
      document.documentElement.dataset.theme = themeParam;
      localStorage.setItem('theme', themeParam);
      setDark(themeParam === 'dark');
    } else {
      setDark(document.documentElement.dataset.theme === 'dark');
    }
  }, [searchParams]);

  if (dark === null) {
    return <span className="block size-[18px]" />;
  }

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    localStorage.setItem('theme', next ? 'dark' : 'light');
    const params = new URLSearchParams(searchParams.toString());
    params.set('theme', next ? 'dark' : 'light');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="p-2 text-muted transition-colors hover:text-foreground"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
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
