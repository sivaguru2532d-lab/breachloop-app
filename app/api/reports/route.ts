/**
 * GET /api/reports — previously generated incident reports (the "Report" export).
 *
 * `?format=jsonl` streams newline-delimited incident logs, which is what the
 * console's Report button downloads. `?format=md` gives a human-readable
 * incident record. Both are produced from the same store as the runs.
 */

import { ok, resilient } from '@/lib/api/respond';
import { listRuns } from '@/lib/engine/runStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get('format') ?? 'json';

  return resilient(
    'GET /api/reports',
    async () => {
      const runs = listRuns(100);

      if (format === 'jsonl') {
        const lines = runs
          .map((run) =>
            JSON.stringify({
              run_id: run.run_id,
              scenario_id: run.scenario_id,
              timestamp: run.timestamp,
              provider_mode: run.provider_mode,
              confidence: run.hypothesis_confidence,
              attack_steps: run.attack_path?.steps?.length ?? 0,
              evidence_event_ids: run.attack_path?.evidence_event_ids ?? [],
              summary: run.hypothesis_summary,
            })
          )
          .join('\n');
        return new Response(lines + (lines ? '\n' : ''), {
          status: 200,
          headers: {
            'content-type': 'application/x-ndjson; charset=utf-8',
            'content-disposition': 'attachment; filename="breachloop-incident-logs.jsonl"',
            'cache-control': 'no-store',
          },
        });
      }

      if (format === 'md') {
        const md = runs
          .map(
            (run) =>
              `## ${run.scenario_id} — ${run.run_id}\n\n` +
              `- timestamp: ${run.timestamp}\n` +
              `- provider: ${run.provider_mode}\n` +
              `- confidence: ${(run.hypothesis_confidence * 100).toFixed(0)}%\n` +
              `- attack path: ${run.attack_path?.steps?.length ?? 0} step(s)\n\n` +
              `${run.hypothesis_summary}\n`
          )
          .join('\n---\n\n');
        return new Response(md || '# No incident reports yet\n', {
          status: 200,
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }

      return ok({
        reports: runs.map((run) => ({
          run_id: run.run_id,
          scenario_id: run.scenario_id,
          timestamp: run.timestamp,
          provider_mode: run.provider_mode,
          hypothesis_summary: run.hypothesis_summary,
          hypothesis_confidence: run.hypothesis_confidence,
          attack_step_count: run.attack_path?.steps?.length ?? 0,
          simulation_count: run.simulations.length,
        })),
        total: runs.length,
        synthetic: true,
      });
    },
    () => ({ reports: [], total: 0, synthetic: true })
  );
}
