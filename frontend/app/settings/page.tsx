import SettingsForm from '@/components/SettingsForm';
import { AppConfig, apiGet } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  let config: AppConfig | null = null;
  try {
    config = await apiGet<AppConfig>('/api/app-config');
  } catch {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        Backend not reachable. Start it with{' '}
        <code className="font-mono">cd backend && npm run start:dev</code>.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Quality-gate settings
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Tune thresholds and per-rule weights at runtime. Changes take effect
          on the <strong>next</strong> ingest &mdash; no restart, no rebuild.
          Defaults seed from <code className="font-mono">.env</code> on first
          boot.
        </p>
      </header>
      <SettingsForm initial={config} />
    </div>
  );
}
