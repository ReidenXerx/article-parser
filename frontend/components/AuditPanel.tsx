import { ArticleDetail } from '@/lib/api';

function decisionColor(d: 'accept' | 'reject' | 'escalate') {
  switch (d) {
    case 'accept':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'reject':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-amber-100 text-amber-800 border-amber-200';
  }
}

function drivePill(permission: string) {
  const cls =
    permission === 'public'
      ? 'bg-green-100 text-green-700'
      : permission === 'private'
        ? 'bg-red-100 text-red-700'
        : permission === 'not-drive'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-slate-100 text-slate-600';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {permission}
    </span>
  );
}

function linkValidationPill(status: string) {
  // OK + skipped + redirect = success-shaped (no alarm).
  // hard-* + soft-404 + unreachable = problem-shaped (red/amber).
  const cls =
    status === 'ok'
      ? 'bg-green-100 text-green-700'
      : status === 'hard-4xx' || status === 'soft-404'
        ? 'bg-red-100 text-red-700'
        : status === 'hard-5xx' || status === 'unreachable'
          ? 'bg-amber-100 text-amber-700'
          : status === 'redirect'
            ? 'bg-sky-100 text-sky-700'
            : 'bg-slate-100 text-slate-500';
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {status}
    </span>
  );
}

export default function AuditPanel({
  article,
}: {
  article: ArticleDetail;
}) {
  const q = article.qualityReport;
  return (
    <div className="space-y-4">
      {/* Verdict */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Verdict
        </div>
        <div
          className={`mt-2 inline-flex items-center rounded-md border px-3 py-1 text-sm font-semibold ${decisionColor(q.finalDecision)}`}
        >
          {q.finalDecision.toUpperCase()}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-slate-500">Deterministic</div>
            <div className="font-mono text-sm text-slate-900">
              {q.deterministic.decision} ·{' '}
              {q.deterministic.score > 0
                ? `+${q.deterministic.score}`
                : q.deterministic.score}
            </div>
          </div>
          <div>
            <div className="text-slate-500">AI second-opinion</div>
            <div className="font-mono text-sm text-slate-900">
              {q.ai ? q.ai.verdict : '—'}
            </div>
          </div>
        </div>
        {q.ai ? (
          <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
            <span className="font-semibold">AI reasoning:</span> {q.ai.reasoning}
          </div>
        ) : null}
      </section>

      {/* Rules fired */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Rules fired ({q.deterministic.rules.length})
        </div>
        <ul className="mt-3 space-y-1.5 text-xs">
          {q.deterministic.rules.map((r) => (
            <li
              key={r.name}
              className="flex items-start justify-between gap-2"
            >
              <div>
                <div className="font-mono text-slate-900">{r.name}</div>
                <div className="text-slate-500">{r.matched}</div>
              </div>
              <span
                className={`shrink-0 rounded-sm px-1.5 py-0.5 font-mono ${
                  r.weight >= 0
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-700'
                }`}
              >
                {r.weight > 0 ? '+' : ''}
                {r.weight}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Image inventory */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Images ({article.images.length})
        </div>
        <ul className="mt-3 space-y-3 text-xs">
          {article.images.map((img, i) => (
            <li key={i} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono text-slate-700">
                  #{i + 1} · {img.kind}
                </span>
                {img.drive ? drivePill(img.drive.permission) : null}
              </div>
              <div className="truncate text-slate-500" title={img.rawUrl}>
                {img.rawUrl}
              </div>
              <div className="text-slate-600">
                alt: {img.altText || <em className="text-slate-400">none</em>}
              </div>
            </li>
          ))}
          {article.images.length === 0 ? (
            <li className="text-slate-400">No images detected.</li>
          ) : null}
        </ul>
      </section>

      {/* Link inventory */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Links ({article.links.length})
        </div>
        <ul className="mt-3 space-y-2 text-xs">
          {article.links.map((l, i) => (
            <li key={i} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] ${
                    l.classification === 'product'
                      ? 'bg-brand-50 text-brand-700'
                      : l.classification === 'brand'
                        ? 'bg-purple-50 text-purple-700'
                        : l.classification === 'image-placeholder'
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-slate-50 text-slate-500'
                  }`}
                >
                  {l.classification}
                </span>
                <span className="flex-1 truncate text-slate-700">
                  {l.anchorText}
                </span>
                {l.validation ? linkValidationPill(l.validation.status) : null}
              </div>
              {l.validation &&
              (l.validation.status === 'hard-4xx' ||
                l.validation.status === 'hard-5xx' ||
                l.validation.status === 'soft-404' ||
                l.validation.status === 'unreachable') ? (
                <div className="pl-2 text-[10px] text-slate-500">
                  {l.validation.detail}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {/* Formatting */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Formatting
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <dt className="text-slate-500">H1 count</dt>
          <dd className="font-mono text-slate-900">
            {article.formatting.h1Count}
          </dd>
          <dt className="text-slate-500">Headings</dt>
          <dd className="font-mono text-slate-900">
            {article.formatting.headingOutline.length}
          </dd>
          <dt className="text-slate-500">Paragraphs</dt>
          <dd className="font-mono text-slate-900">
            {article.formatting.paragraphCount}
          </dd>
          <dt className="text-slate-500">Words</dt>
          <dd className="font-mono text-slate-900">
            {article.formatting.wordCount}
          </dd>
          <dt className="text-slate-500">Max paragraph</dt>
          <dd className="font-mono text-slate-900">
            {article.formatting.maxParagraphChars} chars
          </dd>
        </dl>
      </section>
    </div>
  );
}
