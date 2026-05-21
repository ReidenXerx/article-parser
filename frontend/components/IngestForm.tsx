'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  defaultUrl?: string;
}

export default function IngestForm({ defaultUrl = '' }: Props) {
  const router = useRouter();
  const [source, setSource] = useState(defaultUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/articles/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
      }
      router.push(`/articles/${data.articleId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-5"
    >
      <label
        htmlFor="source"
        className="block text-sm font-medium text-slate-700"
      >
        Google Docs URL or document ID
      </label>
      <input
        id="source"
        type="text"
        required
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="https://docs.google.com/document/d/.../edit"
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Ingesting…' : 'Ingest article'}
        </button>
        <span className="text-xs text-slate-500">
          Click once. The pipeline averages ~3-8 seconds per article.
        </span>
      </div>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </form>
  );
}
