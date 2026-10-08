/**
 * GET /api/reports/:runId — a single incident report, downloadable as JSON,
 * JSONL event log, or CSV evidence table.
 *
 * `?download=1` sets Content-Disposition so the "Report" button can be a plain
 * link if JavaScript is unavailable.
 */

import { ok, resilient, HttpError, sanitizeId } from '@/lib/api/respond';
import { decodeRunId, getRun } from '@/lib/engine/runStore';
import { getRegistry, getScenario } from '@/lib/engine/scenarioStore';
import { reportForScenario } from '@/lib/engine/fallback';
import type { EvidenceReport } from '@/lib/engine/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

function attachment(filename: string, contentType: string) {
  return {
    'content-type': contentType,
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  };
}

async function resolveReport(id: string): Promise<{ report: EvidenceReport; recomputed: boolean }> {
  const stored = getRun(id);
  if (stored?.full_report) return { report: stored.full_report, recomputed: false };

  const scenarioId = decodeRunId(id, getRegistry().order);
  const found = scenarioId ? getScenario(scenarioId) : null;
  if (!found) throw new HttpError(404, `Report not found: ${id}`);

  const { report } = reportForScenario(found.scenario, id, 'deterministic');
  return { report, recomputed: true };
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const id = sanitizeId(runId);
  const params = new URL(request.url).searchParams;
  const format = params.get('format') ?? 'json';
  const download = params.get('download') === '1';

  return resilient(
    `GET /api/reports/${id}`,
    async () => {
      const { report, recomputed } = await resolveReport(id);

      if (format === 'jsonl') {
        const lines = report.events.map((event) => JSON.stringify({ run_id: report.run_id, ...event })).join('\n');
        return new Response(lines + (lines ? '\n' : ''), {
          status: 200,
          headers: attachment(`breachloop-${report.scenario_id}-events.jsonl`, 'application/x-ndjson; charset=utf-8'),
        });
      }

      if (format === 'csv') {
        const header = 'run_id,scenario_id,event_id,event_time,action,service,actor_arn,target_arn,is_supported';
        const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = report.events.map((event) =>
          [report.run_id, report.scenario_id, event.event_id, event.event_time, event.action, event.service, event.actor_arn, event.target_arn ?? '', event.is_supported]
            .map(escape)
            .join(',')
        );
        return new Response([header, ...rows].join('\n') + '\n', {
          status: 200,
          headers: attachment(`breachloop-${report.scenario_id}-evidence.csv`, 'text/csv; charset=utf-8'),
        });
      }

      if (download) {
        return new Response(JSON.stringify(report, null, 2), {
          status: 200,
          headers: attachment(`breachloop-report-${report.scenario_id}.json`, 'application/json; charset=utf-8'),
        });
      }

      return ok({ ...report, ...(recomputed ? { recomputed: true } : {}) });
    },
    (error) => ({
      run_id: id,
      scenario_id: 'unknown',
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      provider_mode: 'deterministic',
      synthetic: true,
      events: [],
      simulations: [],
      warnings: [
        'SYNTHETIC SIMULATOR RESULTS ONLY: This report was produced by an in-process digital twin.',
        'Never use as production cloud authorization or real-world efficacy proof.',
      ],
      detail: error instanceof Error ? error.message : String(error),
    })
  );
}
