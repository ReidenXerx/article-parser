'use client';

import { useState } from 'react';
import { AppConfig } from '@/lib/api';

const KNOWN_RULES = [
  'image.tooFew',
  'image.tooMany',
  'image.healthyCount',
  'image.notHostedOnDrive',
  'image.drivePrivate',
  'image.drivePermUnknown',
  'image.altCoverageFull',
  'image.missingAlt',
  'links.productTooFew',
  'links.productTooMany',
  'links.productHealthyCount',
  'links.brandOnlyNoProduct',
  'fmt.missingH1',
  'fmt.multipleH1',
  'fmt.singleH1',
  'fmt.headingLevelSkip',
  'fmt.missingMetaTitle',
  'fmt.metaTitleTooLong',
  'fmt.metaTitleOk',
  'fmt.missingMetaDescription',
  'fmt.metaDescTooLong',
  'fmt.metaDescTooShort',
  'fmt.metaDescOk',
  'fmt.paragraphWall',
  'fmt.thinContent',
];

interface Props {
  initial: AppConfig;
}

export default function SettingsForm({ initial }: Props) {
  const [cfg, setCfg] = useState<AppConfig>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function setNum<K extends keyof AppConfig>(key: K, val: number) {
    setCfg((c) => ({ ...c, [key]: val }));
  }
  function setWeight(rule: string, val: string) {
    setCfg((c) => {
      const ruleWeights = { ...c.ruleWeights };
      if (val === '') {
        delete ruleWeights[rule];
      } else {
        const n = Number(val);
        if (Number.isFinite(n)) ruleWeights[rule] = n;
      }
      return { ...c, ruleWeights };
    });
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch('/api/app-config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AppConfig;
      setCfg(data);
      setMsg('Saved. Takes effect on next ingest.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Thresholds */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Decision thresholds
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          {(
            [
              ['acceptThreshold', 'Accept threshold (score ≥)'],
              ['rejectThreshold', 'Reject threshold (score ≤)'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="space-y-1">
              <div className="text-xs text-slate-500">{label}</div>
              <input
                type="number"
                value={cfg[k]}
                onChange={(e) => setNum(k, Number(e.target.value))}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
          ))}
        </div>
      </section>

      {/* Bands */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Bands
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          {(
            [
              ['minImages', 'min images'],
              ['maxImages', 'max images'],
              ['minProductLinks', 'min product links'],
              ['maxProductLinks', 'max product links'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="space-y-1">
              <div className="text-xs text-slate-500">{label}</div>
              <input
                type="number"
                min={0}
                value={cfg[k]}
                onChange={(e) => setNum(k, Number(e.target.value))}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
          ))}
        </div>
      </section>

      {/* Per-rule overrides */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Per-rule weight overrides
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Empty = use the rule&rsquo;s default weight. Use this to dial up the
          severity of a single rule without touching code.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          {KNOWN_RULES.map((rule) => (
            <label key={rule} className="flex items-center gap-2">
              <span className="flex-1 truncate font-mono text-xs text-slate-700">
                {rule}
              </span>
              <input
                type="number"
                placeholder="default"
                value={cfg.ruleWeights[rule] ?? ''}
                onChange={(e) => setWeight(rule, e.target.value)}
                className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-xs focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save configuration'}
        </button>
        {msg ? (
          <span className="text-xs text-green-700">{msg}</span>
        ) : null}
        {err ? <span className="text-xs text-red-700">{err}</span> : null}
      </div>
    </div>
  );
}
