/**
 * BreachLoop API client.
 *
 * Every call goes through `lib/api/fetch.ts` (3 retries, exponential backoff with
 * jitter, cold-start-aware, non-blocking) and `lib/api/baseUrl.ts` (relative
 * `/api` by default). Responses are unwrapped tolerantly: both the enveloped
 * shape this API returns (`{ scenarios: [...] }`) and a bare array are accepted,
 * so a client/server version skew degrades gracefully instead of blanking the
 * console.
 */

import { request, ApiError } from './fetch';
import type {
  BenchmarkSummary,
  CandidateAction,
  EvidenceReport,
  HealthResponse,
  IncidentResponse,
  RunIncidentRequest,
  ScenarioDetail,
  ScenarioSummary,
  SimulateResponse,
} from '@/lib/types';

export { ApiError };
export { resolveApiBase, describeApiBase, apiUrl } from './baseUrl';
export type { RequestOptions } from './fetch';

const LIST = <T>(payload: unknown, key: string): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
};

export interface DegradationInfo {
  degraded: boolean;
  notes: string[];
}

function readDegradation(payload: unknown): DegradationInfo {
  if (!payload || typeof payload !== 'object') return { degraded: false, notes: [] };
  const record = payload as Record<string, unknown>;
  const notes = Array.isArray(record['degradation_notes'])
    ? (record['degradation_notes'] as unknown[]).map(String)
    : [];
  return { degraded: Boolean(record['degraded']) || notes.length > 0, notes };
}

/** Fields the console needs alongside the payload, surfaced as non-blocking notices. */
export interface WithDegradation<T> {
  data: T;
  degradation: DegradationInfo;
}

export const api = {
  health(signal?: AbortSignal): Promise<HealthResponse> {
    return request<HealthResponse>('/health', { signal, retries: 3 });
  },

  async listScenarios(signal?: AbortSignal): Promise<WithDegradation<ScenarioSummary[]>> {
    const payload = await request<unknown>('/scenarios', { signal, retries: 3 });
    return { data: LIST<ScenarioSummary>(payload, 'scenarios'), degradation: readDegradation(payload) };
  },

  getScenario(scenarioId: string, signal?: AbortSignal): Promise<ScenarioDetail> {
    return request<ScenarioDetail>(`/scenarios/${encodeURIComponent(scenarioId)}`, { signal, retries: 3 });
  },

  /**
   * Runs the incident. The API answers with the report and scenario detail inline,
   * so this is a single request; the extra GETs below only run if an older API
   * responded without them.
   */
  async runIncident(input: RunIncidentRequest, signal?: AbortSignal): Promise<WithDegradation<IncidentResponse>> {
    type RunPayload = {
      run_id: string;
      scenario_id: string;
      provider_mode: string;
      report?: EvidenceReport;
      scenario_detail?: ScenarioDetail;
    };

    const run = await request<RunPayload>('/incidents/run', {
      method: 'POST',
      body: { scenario_id: input.scenario_id, provider_mode: input.provider_mode ?? 'deterministic' },
      signal,
      // A run mutates state; retry POSTs only while the failure is a cold start.
      retries: 2,
    });

    const [report, scenario] = await Promise.all([
      run.report ?? api.getReport(run.run_id, signal),
      run.scenario_detail ?? api.getScenario(run.scenario_id, signal).catch(() => emptyScenario(run.scenario_id)),
    ]);

    return { data: buildIncidentResponse(report, scenario), degradation: readDegradation(run) };
  },

  getReport(runId: string, signal?: AbortSignal): Promise<EvidenceReport> {
    return request<EvidenceReport>(`/incidents/${encodeURIComponent(runId)}/report`, { signal, retries: 3 });
  },

  simulate(
    runId: string,
    remediationId: string,
    signal?: AbortSignal
  ): Promise<SimulateResponse> {
    return request<SimulateResponse>(`/incidents/${encodeURIComponent(runId)}/simulate`, {
      method: 'POST',
      body: { remediation_id: remediationId },
      signal,
      retries: 2,
    });
  },

  async runBenchmark(signal?: AbortSignal): Promise<WithDegradation<BenchmarkSummary>> {
    const payload = await request<BenchmarkSummary>('/benchmark/run', {
      method: 'POST',
      signal,
      retries: 2,
      timeoutMs: 30000,
    });
    return { data: payload, degradation: readDegradation(payload) };
  },

  listReports(signal?: AbortSignal) {
    return request<{ reports: unknown[]; total: number }>('/reports', { signal, retries: 3 });
  },
};

function emptyScenario(scenarioId: string): ScenarioDetail {
  return {
    scenario_id: scenarioId,
    name: scenarioId,
    description: '',
    scenario_type: 'attack',
    event_count: 0,
    workflow_count: 0,
    candidate_count: 0,
    events: [],
    principals: [],
    roles: [],
    resources: [],
    workloads: [],
    workflows: [],
    candidate_remediations: [],
    ground_truth: {},
  };
}

/**
 * Flattens the API's report + scenario into the console's view model. Tolerant of
 * missing arrays so a partial payload renders instead of throwing mid-render.
 */
export function buildIncidentResponse(
  report: EvidenceReport,
  scenario: ScenarioDetail
): IncidentResponse {
  const candidates: CandidateAction[] = (scenario.candidate_remediations ?? []).map((candidate) => ({
    candidate_id: candidate.id,
    action_type: candidate.remediation_type,
    reasoning: candidate.description,
    parameters: candidate.parameters ?? {},
  }));

  const simulations: IncidentResponse['simulations'] = {};
  for (const simulation of report.simulations ?? []) {
    const workflowResults = simulation.workflow_results ?? [];
    const broken = workflowResults.filter((workflow) => !workflow.is_operational);
    simulations[simulation.remediation_id] = {
      ...simulation,
      proof_or_reason: simulation.reason,
      attacker_reachability_blocked: !simulation.after_reachability?.is_reachable,
      business_workflows_intact:
        workflowResults.length > 0 && workflowResults.every((workflow) => workflow.is_operational),
      broken_workflows: broken.map((workflow) => workflow.workflow_name),
    };
  }

  const reportView = {
    ...report,
    report_id: `report-${report.run_id}`,
    scenario_name: scenario.name,
    scenario_type: scenario.scenario_type,
    candidates,
  };

  return {
    run_id: report.run_id,
    scenario_id: report.scenario_id,
    hypothesis: report.hypothesis,
    attack_path: report.attack_path,
    events: report.events ?? [],
    workflows: (scenario.workflows ?? []).map((workflow) => ({
      workflow_name: workflow.name,
      principal_arn: workflow.principal_arn,
      required_action: workflow.required_action,
      target_resource_arn: workflow.target_resource_arn,
    })),
    candidates,
    simulations,
    report: reportView,
    scenario_detail: scenario,
  };
}

// ── formatting helpers used across the console ──────────────────────────────

export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString || '—';
  return date.toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString || '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function truncateArn(arn: string, maxLength = 50): string {
  if (typeof arn !== 'string' || !arn) return '—';
  if (arn.length <= maxLength) return arn;
  const parts = arn.split(':');
  if (parts.length < 3) return `${arn.slice(0, maxLength)}…`;
  const prefix = parts.slice(0, 3).join(':');
  const resource = parts[parts.length - 1];
  const short = `${prefix}:…:${resource}`;
  return short.length > maxLength ? `${short.slice(0, maxLength)}…` : short;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'verified':
      return 'var(--accent-verified)';
    case 'rejected':
      return 'var(--accent-warning)';
    case 'unverified':
      return 'var(--accent-info)';
    default:
      return 'var(--text-muted)';
  }
}

export function getScenarioTypeClass(type: string): string {
  return type === 'attack' ? 'sidebar__scenario-type--attack' : 'sidebar__scenario-type--benign';
}
