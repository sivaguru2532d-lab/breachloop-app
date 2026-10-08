/**
 * GET /api/incidents/:runId/report — the full evidence report.
 *
 * The reference implementation raised `HTTPException(500, "Report data not
 * available")` whenever the stored row had no report blob; on Vercel the row was
 * never writable, so this is the endpoint that produced most of the 500s. It now
 * re-derives the report from the scenario encoded in the run id.
 */

import { ok, resilient, sanitizeId } from '@/lib/api/respond';
import { decodeRunId, getRun } from '@/lib/engine/runStore';
import { getRegistry, getScenario } from '@/lib/engine/scenarioStore';
import { emergencyReport, reportForScenario } from '@/lib/engine/fallback';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const id = sanitizeId(runId);

  return resilient(
    `GET /api/incidents/${id}/report`,
    () => {
      const stored = getRun(id);
      if (stored?.full_report) return ok(stored.full_report);

      const scenarioId = decodeRunId(id, getRegistry().order);
      const found = scenarioId ? getScenario(scenarioId) : null;

      if (found) {
        const { report, notes } = reportForScenario(found.scenario, id, 'deterministic');
        return ok({
          ...report,
          recomputed: true,
          degradation_notes: [
            'run was not present in this container; the report was deterministically recomputed from the run id',
            ...notes,
          ],
        });
      }

      // Unknown run id: a valid, empty report the console can still render.
      return ok({
        ...emergencyReport(scenarioId ?? 'unknown', id, 'deterministic', new Error('run not found')),
        degradation_notes: [
          `no stored run "${id}" and no matching scenario in the pack; returning an empty report shell`,
        ],
      });
    },
    (error) => emergencyReport('unknown', id, 'deterministic', error)
  );
}
