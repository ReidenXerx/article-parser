import { ArticleDetail } from '@/lib/api';

export default function CostSummary({
  article,
}: {
  article: ArticleDetail;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        AI cost
      </div>
      <div className="mt-2 font-mono text-lg text-slate-900">
        ${article.totalCost.toFixed(6)}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        End-to-end per article. Includes any AI fallback for meta fields and
        the quality-gate second-opinion when borderline.
      </div>
    </section>
  );
}
