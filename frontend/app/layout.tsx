import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Article Parser',
  description:
    'Ingest Google Docs articles, run a layered quality gate, publish to WordPress / Shopify.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link
              href="/"
              className="text-base font-semibold tracking-tight text-slate-900"
            >
              Article Parser
            </Link>
            <nav className="flex items-center gap-6 text-sm text-slate-600">
              <Link href="/" className="hover:text-slate-900">
                Ingest
              </Link>
              <Link href="/articles" className="hover:text-slate-900">
                Articles
              </Link>
              <Link href="/settings" className="hover:text-slate-900">
                Settings
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-4 text-center text-xs text-slate-500">
            Layered quality gate · Configurable thresholds · Per-article
            decision log · Cost-tracked AI
          </div>
        </footer>
      </body>
    </html>
  );
}
