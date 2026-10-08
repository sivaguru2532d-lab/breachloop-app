/**
 * GET /api/health — liveness + capability probe.
 *
 * Always 200. This is the endpoint the console used to fail against; it now
 * reports what the runtime could and could not load, so a degraded environment is
 * visible without breaking the UI.
 */

import { ok, resilient } from '@/lib/api/respond';
import { persistenceStatus, runCount } from '@/lib/engine/runStore';
import { getRegistry, scenarioCount } from '@/lib/engine/scenarioStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

const VERSION = '2.0.0';

export async function GET() {
  return resilient(
    'GET /api/health',
    () => {
      const registry = getRegistry();
      const persistence = persistenceStatus();
      const sources = [...registry.sources.values()];

      return ok({
        status: registry.notes.length > 0 ? 'degraded' : 'healthy',
        service: 'breachloop',
        version: VERSION,
        runtime: 'nextjs-api',
        provider: process.env.ANTHROPIC_API_KEY ? 'anthropic-available' : 'deterministic-only',
        scenarios: scenarioCount(),
        scenario_sources: {
          disk: sources.filter((s) => s === 'disk').length,
          bundled: sources.filter((s) => s === 'bundled').length,
          synthetic: sources.filter((s) => s === 'synthetic').length,
        },
        runs_stored: runCount(),
        persistence: {
          enabled: persistence.enabled,
          writable: persistence.writable,
          path: persistence.path,
          note: persistence.writable
            ? 'incident runs are snapshotted to disk between invocations'
            : 'filesystem not writable; runs are kept in-process and re-derived on demand',
        },
        ...(registry.notes.length > 0 ? { degradation_notes: registry.notes.slice(0, 8) } : {}),
      });
    },
    // Health must answer even if the registry itself explodes.
    (error) => ({
      status: 'degraded',
      service: 'breachloop',
      version: VERSION,
      runtime: 'nextjs-api',
      provider: 'deterministic-only',
      scenarios: 0,
      runs_stored: 0,
      detail: error instanceof Error ? error.message : String(error),
    })
  );
}
