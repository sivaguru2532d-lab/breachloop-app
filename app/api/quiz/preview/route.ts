/**
 * GET|POST /api/quiz/preview — trainer mode, before the learner commits.
 *
 * Returns the same pipeline output a run returns, with every verdict taken out:
 * no twin statuses, no candidate descriptions, no `is_broad`, no `ground_truth`.
 * What is left is what a responder genuinely has — the hypothesis, the path, the
 * events, the workflows that are running, and the fixes on the table by name.
 */

import { ok, resilient, HttpError, readJsonBody, sanitizeId } from '@/lib/api/respond';
import { reportForScenario } from '@/lib/engine/fallback';
import { getScenario } from '@/lib/engine/scenarioStore';
import { buildSyntheticScenario } from '@/lib/engine/scenarioSchema';
import { buildQuizPreview } from '@/lib/api/quiz';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function previewFor(scenarioId: string, route: string) {
  return resilient(
    route,
    async () => {
      if (!scenarioId) throw new HttpError(400, 'scenario_id is required');

      const found = getScenario(scenarioId);
      if (!found) throw new HttpError(404, `Scenario not found: ${scenarioId}`);

      // The provider is never consulted here: a quiz question must not be
      // reworded by a model, and no verdict is on this path anyway.
      const { report, notes } = reportForScenario(found.scenario, `quiz-${scenarioId}`, 'deterministic');
      const preview = buildQuizPreview(found.scenario, report);

      return ok({
        ...preview,
        options_total: preview.options.length,
        ...(notes.length > 0 ? { degraded: true, degradation_notes: notes } : {}),
      });
    },
    (error) => {
      // Degrade to an answerable-but-empty question rather than a 500.
      const scenario = buildSyntheticScenario(scenarioId || 'synthetic-fallback');
      const { report } = reportForScenario(scenario, `quiz-${scenario.id}`, 'deterministic');
      return {
        ...buildQuizPreview(scenario, report),
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return previewFor(sanitizeId(searchParams.get('scenario_id')), 'GET /api/quiz/preview');
}

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return previewFor(sanitizeId(body['scenario_id'] ?? body['scenarioId']), 'POST /api/quiz/preview');
}
