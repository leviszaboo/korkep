import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Header } from '@/components/Header';
import { MobileNav } from '@/components/MobileNav';
import { FooterEmbroidery } from '@/components/FolkPattern';
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
        <Suspense>
          <Header />
        </Suspense>
        <main className="mx-auto max-w-[1400px] px-4 pb-20 pt-8 sm:px-6 sm:pb-8">
          {children}
        </main>
        <footer className="border-t-2 border-foreground py-8 pb-20 sm:pb-8">
          <FooterEmbroidery />
        </footer>
        <MobileNav />
      </body>
    </html>
  );
}
