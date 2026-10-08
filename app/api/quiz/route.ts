/**
 * GET /api/quiz — the trainer's target list.
 *
 * Kept separate from `/api/scenarios` on purpose: the pack summaries carry a
 * `briefing` built for the launch pad, and a learner-facing list should not have
 * to know which fields are safe to show.
 */

import { ok, resilient } from '@/lib/api/respond';
import { listScenarios } from '@/lib/engine/scenarioStore';
import { NO_ACTION_OPTION } from '@/lib/api/quiz';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return resilient(
    'GET /api/quiz',
    () => {
      const { summaries } = listScenarios();
      return ok({
        playable: summaries.map((summary) => ({
          scenario_id: summary.scenario_id,
          name: summary.name,
          scenario_type: summary.scenario_type,
          // A benign pack has one extra option: the correct "don't touch anything".
          options_total: summary.candidate_count + (summary.scenario_type === 'benign' ? 1 : 0),
        })),
        total: summaries.length,
        synthetic: true,
        no_action_option: NO_ACTION_OPTION,
        hint: 'GET /api/quiz/preview?scenario_id=… for the pre-commit view, then POST /api/quiz/grade to commit.',
      });
    },
    () => ({ playable: [], total: 0, synthetic: true, hint: 'Scenario store unavailable.' })
  );
}
