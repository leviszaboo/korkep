'use client';

import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFilter } from './FilterContext';
import { DateFilter } from './DateFilter';

const topics = [
  { key: 'politika', label: 'politika' },
  { key: 'világ', label: 'világ' },
  { key: 'gazdaság', label: 'gazdaság' },
  { key: 'társadalom', label: 'társadalom' },
  { key: 'bűnügyek', label: 'bűnügyek' },
  { key: 'sport', label: 'sport' },
  { key: 'kultúra', label: 'kultúra' },
  { key: 'tudomány', label: 'tudomány' },
  { key: 'technológia', label: 'tech' },
  { key: 'egészség', label: 'egészség' },
  { key: 'szórakozás', label: 'szórakozás' },
];

const topicIcons: Record<string, React.ReactNode> = {
  politika: <PoliticsIcon />,
  világ: <WorldIcon />,
  gazdaság: <EconomyIcon />,
  társadalom: <SocietyIcon />,
  bűnügyek: <CrimeIcon />,
  sport: <SportsIcon />,
  kultúra: <CultureIcon />,
  tudomány: <ScienceIcon />,
  technológia: <TechIcon />,
  egészség: <HealthIcon />,
  szórakozás: <CultureIcon />,
};

export function TopicFilter() {
  const searchParams = useSearchParams();
  const { optimisticTopic, navigate } = useFilter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  function handleClick(topicKey?: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (topicKey) {
      params.set('topic', topicKey);
    } else {
      params.delete('topic');
    }
    params.delete('page');
    const qs = params.toString();
    const href = qs ? `/?${qs}` : '/';
    navigate(href, { topic: topicKey ?? null });
    setMenuOpen(false);
  }

  const activeLabel = optimisticTopic
    ? topics.find((t) => t.key === optimisticTopic)?.label ?? optimisticTopic
    : 'All';

  return (
    <div className="flex items-center gap-3">
      {/* Mobile: hamburger + dropdown */}
      <div className="relative flex min-w-0 flex-1 sm:hidden" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-medium text-foreground"
        >
          <HamburgerIcon />
          <span className="capitalize">{activeLabel}</span>
          <ChevronIcon open={menuOpen} />
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-base py-1 shadow-lg">
            <button
              onClick={() => handleClick()}
              className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                !optimisticTopic ? 'bg-surface font-medium text-foreground' : 'text-muted'
              }`}
            >
              <GridIcon />
              All
            </button>
            {topics.map((topic) => (
              <button
                key={topic.key}
                onClick={() => handleClick(topic.key)}
                className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-sm capitalize transition-colors ${
                  optimisticTopic === topic.key ? 'bg-surface font-medium text-foreground' : 'text-muted'
                }`}
              >
                {topicIcons[topic.key]}
                {topic.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: horizontal pills */}
      <div className="hidden min-w-0 flex-1 gap-2 overflow-x-auto scrollbar-none sm:flex">
        <FilterPill onClick={() => handleClick()} active={!optimisticTopic} icon={<GridIcon />}>
          All
        </FilterPill>
        {topics.map((topic) => (
          <FilterPill
            key={topic.key}
            onClick={() => handleClick(topic.key)}
            active={optimisticTopic === topic.key}
            icon={topicIcons[topic.key]}
          >
            {topic.label}
          </FilterPill>
        ))}
      </div>
      <div className="h-5 w-px shrink-0 bg-border" />
      <DateFilter />
    </div>
  );
}

function FilterPill({
  onClick,
  active,
  icon,
  children,
}: {
  onClick: () => void;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm capitalize transition-colors ${
        active
          ? 'bg-foreground text-base font-medium'
          : 'bg-surface text-muted hover:text-foreground'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function HamburgerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <rect x="2" y="2" width="4" height="4" rx="1" />
      <rect x="8" y="2" width="4" height="4" rx="1" />
      <rect x="2" y="8" width="4" height="4" rx="1" />
      <rect x="8" y="8" width="4" height="4" rx="1" />
    </svg>
  );
}

function PoliticsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.5L2 4.5H12L7 1.5Z" />
      <line x1="4" y1="5.5" x2="4" y2="10" />
      <line x1="7" y1="5.5" x2="7" y2="10" />
      <line x1="10" y1="5.5" x2="10" y2="10" />
      <line x1="2" y1="11" x2="12" y2="11" />
    </svg>
  );
}

function EconomyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1.5,10.5 5,7 8,9 12.5,3.5" />
      <polyline points="10,3.5 12.5,3.5 12.5,6" />
    </svg>
  );
}

function SportsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M4.5 2H9.5V6.5C9.5 8.5 8.5 9.5 7 9.5C5.5 9.5 4.5 8.5 4.5 6.5V2Z" />
      <path d="M4.5 4H3C3 5.5 3.5 6.5 4.5 6.5" />
      <path d="M9.5 4H11C11 5.5 10.5 6.5 9.5 6.5" />
      <line x1="7" y1="9.5" x2="7" y2="11.5" />
      <line x1="5.5" y1="11.5" x2="8.5" y2="11.5" />
    </svg>
  );
}

function TechIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,3 1.5,7 4,11" />
      <polyline points="10,3 12.5,7 10,11" />
      <line x1="8.5" y1="2" x2="5.5" y2="12" />
    </svg>
  );
}

function CultureIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.5L8.3 5.3L12.5 5.3L9.1 7.7L10.4 11.5L7 9.1L3.6 11.5L4.9 7.7L1.5 5.3L5.7 5.3L7 1.5Z" />
    </svg>
  );
}

function WorldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="7" cy="7" r="5.5" />
      <ellipse cx="7" cy="7" rx="2.5" ry="5.5" />
      <line x1="1.5" y1="7" x2="12.5" y2="7" />
    </svg>
  );
}

function SocietyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <circle cx="5" cy="4" r="2" />
      <circle cx="10" cy="4.5" r="1.5" />
      <path d="M1 11C1 8.5 3 7.5 5 7.5C7 7.5 9 8.5 9 11" />
      <path d="M9 11C9 9 10 8 11 8C12 8 13 9 13 11" />
    </svg>
  );
}

function CrimeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.5V4.5" />
      <path d="M4.5 6C4.5 4.6 5.6 3.5 7 3.5C8.4 3.5 9.5 4.6 9.5 6V8L10.5 10.5H3.5L4.5 8V6Z" />
      <line x1="3.5" y1="12" x2="10.5" y2="12" />
      <line x1="5" y1="10.5" x2="5" y2="12" />
      <line x1="9" y1="10.5" x2="9" y2="12" />
    </svg>
  );
}

function ScienceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 1.5V5L2 11.5H12L9 5V1.5" />
      <line x1="4" y1="1.5" x2="10" y2="1.5" />
      <path d="M4 9H10" />
    </svg>
  );
}

function HealthIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 12L2.5 7.5C1 6 1 3.5 3 2.5C4.5 1.7 6 2.5 7 3.5C8 2.5 9.5 1.7 11 2.5C13 3.5 13 6 11.5 7.5L7 12Z" />
    </svg>
  );
}
