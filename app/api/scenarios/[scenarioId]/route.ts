/**
 * GET /api/scenarios/:scenarioId — full scenario detail (topology + events).
 *
 * An unknown id is an honest 404 (client mistake, not a server fault). Any
 * genuine fault inside loading/parsing degrades to a generated scenario marked
 * `degraded` — never a 500, which is what used to blank the console.
 */

import { ok, resilient, HttpError, sanitizeId } from '@/lib/api/respond';
import { buildSyntheticScenario } from '@/lib/engine/scenarioSchema';
import { scenarioDetail } from '@/lib/api/serializers';
import { getScenario } from '@/lib/engine/scenarioStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

export async function GET(_request: Request, context: { params: Promise<{ scenarioId: string }> }) {
  const { scenarioId } = await context.params;
  const id = sanitizeId(scenarioId);

  return resilient(
    `GET /api/scenarios/${id}`,
    () => {
      const found = getScenario(id);
      if (!found) throw new HttpError(404, `Scenario not found: ${id}`);
      return ok(scenarioDetail(found.scenario, found.notes.slice(0, 8)));
    },
    (error) =>
      scenarioDetail(
        buildSyntheticScenario(id || 'synthetic-fallback'),
        [`scenario "${id}" could not be loaded (${error instanceof Error ? error.message : String(error)}); served a generated scenario`]
      )
  );
}
