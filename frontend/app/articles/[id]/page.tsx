import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArticleDetail, apiGet } from '@/lib/api';
import AuditPanel from '@/components/AuditPanel';
import MetaCards from '@/components/MetaCards';
import PublishButtons from '@/components/PublishButtons';
import CostSummary from '@/components/CostSummary';

export const dynamic = 'force-dynamic';

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let article: ArticleDetail;
  try {
    article = await apiGet<ArticleDetail>(`/api/articles/${id}`);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/articles"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← back to articles
        </Link>
        <a
          href={article.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          Open source doc ↗
        </a>
      </div>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {article.meta.articleTitle || '(no title)'}
        </h1>
        <div className="mt-1 font-mono text-xs text-slate-500">
          docId={article.docId} · ingest={article.ingestMode}
        </div>
      </header>

      <MetaCards meta={article.meta} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PublishButtons
            articleId={article.id}
            decision={article.qualityReport.finalDecision}
            publishedTo={article.publishedTo}
          />
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Cleaned WordPress-ready body
              </h2>
              <span className="font-mono text-xs text-slate-500">
                {article.bodyClean.length} bytes
              </span>
            </div>
            <article
              className="article-preview"
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              dangerouslySetInnerHTML={{ __html: article.bodyClean }}
            />
          </section>
        </div>

        <aside className="space-y-6">
          <AuditPanel article={article} />
          <CostSummary article={article} />
        </aside>
      </div>
    </div>
  );
}
