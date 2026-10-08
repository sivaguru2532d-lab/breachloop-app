/**
 * GET /api/incidents/:runId — stored run metadata + simulation results.
 *
 * Falls back to deterministic recomputation when the run is not in this
 * container's store, which is the normal case on serverless: the run id encodes
 * its scenario, so the answer is reproducible without shared state.
 */

import { ok, resilient, HttpError, sanitizeId } from '@/lib/api/respond';
import { getRun, decodeRunId } from '@/lib/engine/runStore';
import { getRegistry, getScenario } from '@/lib/engine/scenarioStore';
import { reportForScenario } from '@/lib/engine/fallback';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const id = sanitizeId(runId);

  return resilient(
    `GET /api/incidents/${id}`,
    () => {
      const stored = getRun(id);
      if (stored) {
        return ok({
          ...stored,
          simulation_count: stored.simulations.length,
          synthetic: true,
        });
      }

      // Store miss → re-derive from the run id instead of 404ing.
      const scenarioId = decodeRunId(id, getRegistry().order);
      if (!scenarioId) throw new HttpError(404, `Incident run not found: ${id}`);

      const found = getScenario(scenarioId);
      if (!found) throw new HttpError(404, `Incident run not found: ${id}`);

      const { report, notes } = reportForScenario(found.scenario, id, 'deterministic');
      return ok({
        run_id: report.run_id,
        scenario_id: report.scenario_id,
        provider_mode: report.provider_mode,
        timestamp: report.timestamp,
        synthetic: true,
        hypothesis_summary: report.hypothesis.summary,
        hypothesis_confidence: report.hypothesis.confidence,
        attack_path: report.attack_path,
        full_report: report,
        simulations: report.simulations,
        simulation_count: report.simulations.length,
        recomputed: true,
        degradation_notes: [
          'run was not present in this container; the report was deterministically recomputed from the run id',
          ...notes,
        ],
      });
    },
    () => ({
      run_id: id,
      scenario_id: 'unknown',
      provider_mode: 'deterministic',
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      synthetic: true,
      simulations: [],
      simulation_count: 0,
    })
  );
}
