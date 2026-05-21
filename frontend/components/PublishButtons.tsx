'use client';

import { useState } from 'react';

interface Props {
  articleId: string;
  decision: 'accept' | 'reject' | 'escalate';
  publishedTo: string | null;
}

interface PublishResult {
  status: 'ok' | 'failed' | 'skipped';
  externalId: string | null;
  detail: string;
  mock: boolean;
}

export default function PublishButtons({
  articleId,
  decision,
  publishedTo,
}: Props) {
  const [busy, setBusy] = useState<null | 'wordpress' | 'shopify'>(null);
  const [result, setResult] = useState<{
    target: 'wordpress' | 'shopify';
    result: PublishResult;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);

  async function publish(target: 'wordpress' | 'shopify') {
    setBusy(target);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/articles/${articleId}/publish/${target}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ force: override }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
      }
      setResult({ target, result: data });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const enabled = decision === 'accept' || override;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Publish
          </h2>
          {publishedTo ? (
            <div className="mt-1 text-xs text-slate-500">
              Previously published to{' '}
              <span className="font-mono text-slate-700">{publishedTo}</span>.
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {decision !== 'accept' ? (
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              Override gate (force publish)
            </label>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          disabled={!enabled || busy !== null}
          onClick={() => publish('wordpress')}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'wordpress' ? 'Publishing…' : 'Publish to WordPress'}
        </button>
        <button
          type="button"
          disabled={!enabled || busy !== null}
          onClick={() => publish('shopify')}
          className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'shopify' ? 'Publishing…' : 'Publish to Shopify'}
        </button>
      </div>

      {!enabled && !publishedTo ? (
        <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Quality gate verdict is{' '}
          <span className="font-mono font-semibold">{decision}</span>. Resolve
          the flagged issues and re-ingest, or check &ldquo;Override
          gate&rdquo; to publish anyway.
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          <div className="font-semibold">
            ✓ {result.target} ·{' '}
            {result.result.mock ? 'MOCK' : 'LIVE'} ·{' '}
            {result.result.externalId
              ? `id=${result.result.externalId}`
              : '(no id)'}
          </div>
          <div className="mt-1 text-green-700">{result.result.detail}</div>
        </div>
      ) : null}
    </section>
  );
}
