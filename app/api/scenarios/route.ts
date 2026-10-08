/**
 * GET /api/scenarios — scenario pack listing.
 *
 * Replaces the FastAPI handler that called `get_database()`, which created
 * `breachloop.sqlite` in the CWD and threw on a read-only filesystem. Here the
 * pack is read from disk, falling back to the statically bundled copy, so this
 * route has no failure mode that can empty the sidebar.
 */

import { ok, resilient } from '@/lib/api/respond';
import { scenarioBriefing, type LaunchBriefing } from '@/lib/api/briefing';
import { buildSyntheticScenario } from '@/lib/engine/scenarioSchema';
import { allScenarios, listScenarios } from '@/lib/engine/scenarioStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

export async function GET() {
  return resilient(
    'GET /api/scenarios',
    () => {
      const { summaries, notes } = listScenarios();
      // Briefings ride along so the launch pad needs exactly one request. They
      // are derived, not stored on the pack, and are memoized per parsed pack.
      const briefings = new Map<string, LaunchBriefing>(
        allScenarios().map((scenario) => [scenario.id, scenarioBriefing(scenario)])
      );
      const scenarios = summaries.map((summary) => ({
        ...summary,
        briefing: briefings.get(summary.scenario_id),
      }));
      return ok({
        scenarios,
        total: summaries.length,
        synthetic: true,
        ...(notes.length > 0 ? { degradation_notes: notes.slice(0, 8) } : {}),
      });
    },
    (error) => {
      const scenario = buildSyntheticScenario();
      return {
        scenarios: [
          {
            scenario_id: scenario.id,
            name: scenario.name,
            description: scenario.description,
            scenario_type: scenario.scenario_type,
            event_count: scenario.raw_events.length,
            workflow_count: scenario.workflows.length,
            candidate_count: scenario.candidate_remediations.length,
            briefing: scenarioBriefing(scenario),
          },
        ],
        total: 1,
        synthetic: true,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  );
}
