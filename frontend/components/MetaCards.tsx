import { ArticleDetail } from '@/lib/api';

function sourceTag(source: string) {
  switch (source) {
    case 'h1':
    case 'regex':
      return (
        <span className="rounded-sm bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
          {source}
        </span>
      );
    case 'ai-fallback':
      return (
        <span className="rounded-sm bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
          AI fallback
        </span>
      );
    case 'missing':
      return (
        <span className="rounded-sm bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
          missing
        </span>
      );
    default:
      return (
        <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
          {source}
        </span>
      );
  }
}

export default function MetaCards({
  meta,
}: {
  meta: ArticleDetail['meta'];
}) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
          Article title
          {sourceTag(meta.source.articleTitle)}
        </div>
        <div className="mt-2 text-sm leading-snug text-slate-900">
          {meta.articleTitle || (
            <span className="italic text-slate-400">missing</span>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
          Meta title
          {sourceTag(meta.source.metaTitle)}
        </div>
        <div className="mt-2 text-sm leading-snug text-slate-900">
          {meta.metaTitle || (
            <span className="italic text-slate-400">missing</span>
          )}
        </div>
        <div className="mt-2 font-mono text-xs text-slate-500">
          {meta.metaTitle?.length ?? 0} chars
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
          Meta description
          {sourceTag(meta.source.metaDescription)}
        </div>
        <div className="mt-2 text-sm leading-snug text-slate-900">
          {meta.metaDescription || (
            <span className="italic text-slate-400">missing</span>
          )}
        </div>
        <div className="mt-2 font-mono text-xs text-slate-500">
          {meta.metaDescription?.length ?? 0} chars
        </div>
      </div>
    </section>
  );
}
