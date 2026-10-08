/**
 * POST /api/incidents/:runId/simulate — re-run a single remediation candidate in
 * the digital twin (the "what if I apply only this fix?" interaction).
 */

import { ok, resilient, HttpError, readJsonBody, sanitizeId } from '@/lib/api/respond';
import { createBaselineTwinState, DigitalTwin } from '@/lib/engine/twin';
import { normalizeEvents } from '@/lib/engine/normalizer';
import { getRegistry, getScenario } from '@/lib/engine/scenarioStore';
import { decodeRunId, getRun } from '@/lib/engine/runStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const id = sanitizeId(runId);
  const body = await readJsonBody(request);
  const remediationId = String(body['remediation_id'] ?? '');

  return resilient(
    `POST /api/incidents/${id}/simulate`,
    () => {
      if (!remediationId) throw new HttpError(400, 'remediation_id is required');

      const stored = getRun(id);
      // decodeRunId also handles well-formed ids for scenarios outside the pack.
      const scenarioId = stored?.scenario_id ?? decodeRunId(id, getRegistry().order);
      if (!scenarioId) throw new HttpError(404, `Incident run not found: ${id}`);

      const found = getScenario(scenarioId);
      if (!found) throw new HttpError(404, `Scenario not found: ${scenarioId}`);
      const scenario = found.scenario;

      const candidate = scenario.candidate_remediations.find((c) => c.id === remediationId);
      if (!candidate) {
        // Not a server fault: answer 404 with the ids that do exist.
        throw new HttpError(
          404,
          `Remediation candidate not found: ${remediationId}. Available: ${scenario.candidate_remediations
            .map((c) => c.id)
            .join(', ') || 'none'}`
        );
      }

      const events = normalizeEvents(scenario.raw_events);
      const twin = new DigitalTwin(
        createBaselineTwinState(
          scenario.principals,
          scenario.roles,
          scenario.resources,
          scenario.workloads,
          scenario.workflows,
          events
        )
      );
      const simulation = twin.simulate(candidate);

      return ok({
        run_id: id,
        remediation_id: simulation.remediation_id,
        status: simulation.status,
        reason: simulation.reason,
        before_reachability: simulation.before_reachability,
        after_reachability: simulation.after_reachability,
        workflow_results: simulation.workflow_results,
        proof_details: simulation.proof_details,
        synthetic: true,
      });
    },
    (error) => ({
      run_id: id,
      remediation_id: remediationId,
      status: 'unverified',
      reason: `Simulation unavailable (${error instanceof Error ? error.message : String(error)}); no claim is made about this candidate.`,
      before_reachability: {
        attacker_entry_arn: 'unknown',
        target_resource_arn: 'unknown',
        is_reachable: false,
        path_summary: 'unavailable',
      },
      after_reachability: {
        attacker_entry_arn: 'unknown',
        target_resource_arn: 'unknown',
        is_reachable: false,
        path_summary: 'unavailable',
      },
      workflow_results: [],
      synthetic: true,
    })
  );
}
