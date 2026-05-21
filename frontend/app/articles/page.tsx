import Link from 'next/link';
import { ArticleSummary, apiGet } from '@/lib/api';

export const dynamic = 'force-dynamic';

function decisionBadge(decision: ArticleSummary['finalDecision']) {
  const color =
    decision === 'accept'
      ? 'bg-green-100 text-green-800 border-green-200'
      : decision === 'reject'
        ? 'bg-red-100 text-red-800 border-red-200'
        : 'bg-amber-100 text-amber-800 border-amber-200';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {decision}
    </span>
  );
}

export default async function ArticlesPage() {
  let articles: ArticleSummary[] = [];
  try {
    articles = await apiGet<ArticleSummary[]>('/api/articles');
  } catch (err) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        Failed to load articles. Is the backend running on{' '}
        <code className="font-mono">http://localhost:3001</code>? {String(err)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Ingested articles
        </h1>
        <Link
          href="/"
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-600"
        >
          + Ingest new article
        </Link>
      </div>
      {articles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No articles ingested yet. Paste a Google Doc URL on the ingest page
          to get started.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Decision</th>
                <th className="px-4 py-2">Score</th>
                <th className="px-4 py-2">Cost</th>
                <th className="px-4 py-2">Published</th>
                <th className="px-4 py-2">Ingested</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="max-w-md truncate px-4 py-2">
                    <Link
                      href={`/articles/${a.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {a.articleTitle || '(no title)'}
                    </Link>
                    <div className="truncate text-xs text-slate-500">
                      {a.docId}
                    </div>
                  </td>
                  <td className="px-4 py-2">{decisionBadge(a.finalDecision)}</td>
                  <td className="px-4 py-2 font-mono text-sm">
                    {a.score > 0 ? `+${a.score}` : a.score}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    ${a.totalCost.toFixed(6)}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {a.publishedTo
                      ? `${a.publishedTo}${a.publishedAt ? ` · ${new Date(a.publishedAt).toLocaleDateString()}` : ''}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
