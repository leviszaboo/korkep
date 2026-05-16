import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Header } from '@/components/Header';
import { MobileNav } from '@/components/MobileNav';
import { FolkPattern } from '@/components/FolkPattern';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: {
    default: 'Körkép',
    template: '%s — Körkép',
  },
  description: 'See how Hungarian news outlets cover the same stories. Compare perspectives across the political spectrum.',
};

const themeScript = `(function(){var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.dataset.theme='dark'}else{document.documentElement.dataset.theme='light'}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-base text-foreground">
        <FolkPattern />
        <Header />
        <main className="mx-auto max-w-[1400px] px-4 pb-20 pt-8 sm:px-6 sm:pb-8">
          {children}
        </main>
        <footer className="border-t border-border py-8 pb-20 sm:pb-8">
          <div className="flex flex-col items-center gap-3">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <g transform="translate(10,10)" fill="var(--ac)" opacity="0.25">
                {[0, 72, 144, 216, 288].map((a) => (
                  <path key={a} d="M0,-2 C1.5,-3.5 1.5,-6 0,-7.5 C-1.5,-6 -1.5,-3.5 0,-2Z" transform={`rotate(${a})`} />
                ))}
                <circle r="1.2" />
              </g>
            </svg>
            <span className="text-xs text-faint">Körkép — Hungarian News Panorama</span>
          </div>
        </footer>
        <MobileNav />
      </body>
    </html>
  );
}
