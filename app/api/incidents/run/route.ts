/**
 * POST /api/incidents/run — the "Run Incident" action.
 *
 * Runs the full pipeline (normalize → graph → attack path → hypothesis → digital
 * twin over every candidate) and returns the completed evidence report INLINE.
 *
 * That inline payload is deliberate: the old flow was POST run → GET report →
 * GET scenario, three sequential serverless invocations, where a miss on any one
 * of them (cold container, store not yet hydrated) surfaced as a blocking error.
 * One request now populates the entire console.
 */

import { randomUUID } from 'node:crypto';
import { ok, resilient, HttpError, readJsonBody, sanitizeId } from '@/lib/api/respond';
import { encodeRunId, saveRun } from '@/lib/engine/runStore';
import { enrichHypothesis, resolveProviderMode } from '@/lib/engine/provider';
import { reportForScenario } from '@/lib/engine/fallback';
import { getScenario, listScenarios } from '@/lib/engine/scenarioStore';
import { buildSyntheticScenario } from '@/lib/engine/scenarioSchema';
import { scenarioDetail } from '@/lib/api/serializers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const scenarioId = sanitizeId(body['scenario_id'] ?? body['scenarioId']);
  const providerMode = body['provider_mode'] === 'anthropic' ? 'anthropic' : 'deterministic';

  return resilient(
    'POST /api/incidents/run',
    async () => {
      if (!scenarioId) throw new HttpError(400, 'scenario_id is required');

      const found = getScenario(scenarioId);
      if (!found) throw new HttpError(404, `Scenario not found: ${scenarioId}`);

      const scenario = found.scenario;
      const runId = encodeRunId(scenario.id, randomUUID().replace(/-/g, '').slice(0, 10));
      const resolution = resolveProviderMode(providerMode);
      const { report, notes } = reportForScenario(scenario, runId, resolution.provider_mode);

      const { hypothesis, notes: providerNotes } = await enrichHypothesis(
        report.hypothesis,
        scenario.name,
        resolution
      );
      const finalReport = { ...report, hypothesis, provider_mode: resolution.provider_mode };
      const degradationNotes = [...notes, ...resolution.notes, ...providerNotes];

      if (degradationNotes.length > 0) {
        finalReport.degraded = true;
        finalReport.degradation_notes = degradationNotes;
      }

      // Best-effort persistence: saveRun swallows its own I/O failures.
      const stored = saveRun(finalReport, finalReport.attack_path, finalReport.simulations);

      return ok({
        run_id: stored.run_id,
        scenario_id: stored.scenario_id,
        provider_mode: stored.provider_mode,
        status: 'completed',
        /** Inline so the console renders from a single round trip. */
        report: finalReport,
        scenario_detail: scenarioDetail(scenario),
        ...(degradationNotes.length > 0 ? { degraded: true, degradation_notes: degradationNotes } : {}),
      });
    },
    (error) => {
      // No 500 even if the pack, the store and the twin all fail.
      const scenario = buildSyntheticScenario(scenarioId || 'synthetic-fallback');
      const runId = encodeRunId(scenario.id, randomUUID().replace(/-/g, '').slice(0, 10));
      const { report, notes } = reportForScenario(scenario, runId, providerMode);
      return {
        run_id: runId,
        scenario_id: scenario.id,
        provider_mode: providerMode,
        status: 'completed',
        report,
        scenario_detail: scenarioDetail(scenario),
        detail: error instanceof Error ? error.message : String(error),
        degradation_notes: [...notes],
      };
    }
  );
}

/** GET is allowed as a discoverability aid: it lists what can be run. */
export async function GET() {
  return resilient(
    'GET /api/incidents/run',
    () => {
      const { summaries } = listScenarios();
      return ok({
        runnable: summaries.map((s) => s.scenario_id),
        total: summaries.length,
        hint: 'POST { scenario_id, provider_mode } to this route to run an incident.',
      });
    },
    () => ({ runnable: [], total: 0, hint: 'POST { scenario_id } to run an incident.' })
  );
}
