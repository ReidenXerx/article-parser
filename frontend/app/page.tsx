import IngestForm from '@/components/IngestForm';

const DEMO_DOC_URL =
  'https://docs.google.com/document/d/1syYirDYpa8B4SoT3ITYeknDvQmdIeuFq5QW7WmbEVVc/edit';

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Ingest a Google Doc article
        </h1>
        <p className="max-w-2xl text-sm text-slate-600">
          Paste a Google Docs URL (any link-sharing setting). The pipeline
          fetches the document, runs five focused extractors, probes Drive
          for image accessibility, then scores the article through the
          layered quality gate. AI second-opinion only fires on borderline
          verdicts &mdash; mirroring the cost-aware pattern from{' '}
          <span className="font-mono text-slate-500">Sourcerer-Be</span>.
        </p>
      </section>

      <IngestForm defaultUrl={DEMO_DOC_URL} />

      <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
        <div className="font-medium text-slate-800">Pipeline at a glance</div>
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li>Fetch the doc via public export → Drive API fallback.</li>
          <li>
            Extract meta fields (regex first, AI fallback), clean body HTML
            for WordPress, inventory images, classify links, audit formatting.
          </li>
          <li>
            HEAD-probe every image URL to verify public Drive accessibility.
          </li>
          <li>
            Score against weighted rules &rarr; <strong>accept</strong> /
            <strong> reject</strong> / <strong> escalate</strong>.
          </li>
          <li>
            On <em>escalate</em>, ask the AI second-opinion. Fail-open if it
            errors.
          </li>
          <li>
            Persist the article + full decision log + per-article AI cost.
          </li>
        </ol>
      </section>
    </div>
  );
}
