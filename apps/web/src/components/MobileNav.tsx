'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/', label: 'Stories', icon: NewspaperIcon },
  { href: '/search', label: 'Search', icon: SearchIcon },
  { href: '/sources', label: 'Sources', icon: LayersIcon },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-base/90 backdrop-blur-md sm:hidden">
      <div className="flex items-center justify-around">
        {tabs.map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
                active ? 'text-accent font-medium' : 'text-muted'
              }`}
            >
              <tab.icon active={active} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function NewspaperIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.3} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <line x1="6" y1="7" x2="14" y2="7" />
      <line x1="6" y1="10" x2="10" y2="10" />
      <line x1="6" y1="13" x2="14" y2="13" />
      <rect x="11.5" y="9.5" width="2.5" height="2.5" rx="0.5" />
    </svg>
  );
}

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.3} strokeLinecap="round">
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13 13L17 17" />
    </svg>
  );
}

function LayersIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3L3 7L10 11L17 7L10 3Z" />
      <path d="M3 10L10 14L17 10" />
      <path d="M3 13L10 17L17 13" />
    </svg>
  );
}
