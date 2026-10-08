/**
 * POST /api/quiz/grade — the learner commits; only now does the twin speak.
 *
 * Answers with the real verdict for every candidate plus the pack's expected
 * labels. That is the whole design of trainer mode: the answer key is reachable,
 * but never before a choice is made. Recomputed from the pack each time, so there
 * is no session to lose and nothing cached to leak into the next attempt.
 */

import { ok, resilient, HttpError, readJsonBody, sanitizeId } from '@/lib/api/respond';
import { reportForScenario } from '@/lib/engine/fallback';
import { getScenario } from '@/lib/engine/scenarioStore';
import { buildSyntheticScenario } from '@/lib/engine/scenarioSchema';
import { buildQuizPreview, gradeQuizAnswer } from '@/lib/api/quiz';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const scenarioId = sanitizeId(body['scenario_id'] ?? body['scenarioId']);
  const optionId = typeof body['option_id'] === 'string' ? body['option_id'].trim() : '';

  return resilient(
    'POST /api/quiz/grade',
    async () => {
      if (!scenarioId) throw new HttpError(400, 'scenario_id is required');
      if (!optionId) throw new HttpError(400, 'option_id is required');

      const found = getScenario(scenarioId);
      if (!found) throw new HttpError(404, `Scenario not found: ${scenarioId}`);

      const { report, notes } = reportForScenario(found.scenario, `quiz-${scenarioId}`, 'deterministic');
      // An unknown option is a client bug, not a wrong answer: reject, don't mark wrong.
      const legal = new Set(buildQuizPreview(found.scenario, report).options.map((option) => option.id));
      if (!legal.has(optionId)) {
        throw new HttpError(400, `option_id "${optionId}" is not one of: ${[...legal].join(', ')}`);
      }

      const grade = gradeQuizAnswer(found.scenario, report, optionId);
      return ok({
        ...grade,
        graded: true,
        ...(notes.length > 0 ? { degraded: true, degradation_notes: notes } : {}),
      });
    },
    (error) => {
      // An ungradeable attempt must never cost the learner a point.
      const scenario = buildSyntheticScenario(scenarioId || 'synthetic-fallback');
      const { report } = reportForScenario(scenario, `quiz-${scenario.id}`, 'deterministic');
      return {
        ...gradeQuizAnswer(scenario, report, optionId),
        graded: false,
        correct: false,
        explanation: 'The twin could not grade this attempt, so it was not scored. Try again.',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  );
}
