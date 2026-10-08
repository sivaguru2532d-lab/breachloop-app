/**
 * POST|GET /api/benchmark/run — the synthetic benchmark scorecard.
 *
 * The reference handler called `run_benchmark()` on a `Path(__file__).parents[3]`
 * guess at the repo layout, which does not exist inside a serverless bundle, and
 * returned 500. The pack is now bundled with the handler, so this route works
 * from any working directory and answers 200 even when the pack is missing.
 */

import { ok, resilient } from '@/lib/api/respond';
import { allScenarios, getRegistry } from '@/lib/engine/scenarioStore';
import { runBenchmarkSuite } from '@/lib/engine/simulation';
import { BENCHMARK_DISCLAIMER } from '@/lib/engine/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

async function run() {
  const registry = getRegistry();
  const notes = [...registry.notes];
  const summary = runBenchmarkSuite(allScenarios(), notes);
  return summary;
}

export async function POST() {
  return resilient(
    'POST /api/benchmark/run',
    async () => ok(await run()),
    (error) => ({
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      total_scenarios: 0,
      attack_scenarios_count: 0,
      benign_scenarios_count: 0,
      passed_scenarios: 0,
      failed_scenarios: 0,
      accuracy_percentage: 0,
      results: [],
      synthetic: true,
      disclaimer: `${BENCHMARK_DISCLAIMER} The scenario pack could not be evaluated.`,
      detail: error instanceof Error ? error.message : String(error),
    })
  );
}

/** GET is supported too, so the scorecard can be linked/bookmarked directly. */
export async function GET() {
  return POST();
}
