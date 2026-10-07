/**
 * BreachLoop API Client
 * Type-safe fetch wrapper for FastAPI backend
 */

import type {
  ScenarioSummary,
  ScenarioDetail,
  RunIncidentRequest,
  RunIncidentResponse,
  IncidentResponse,
  SimulateRequest,
  SimulateResponse,
  EvidenceReport,
  BenchmarkSummary,
  HealthResponse,
} from '../types';

const API_BASE = '/api';

class ApiError extends Error {
  constructor(
    public status: number,
    public data: any,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: any;
    try {
      errorData = await response.json();
    } catch {
      errorData = { detail: response.statusText };
    }
    throw new ApiError(response.status, errorData, errorData.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

export const api = {
  /**
   * Health check endpoint
   */
  async health(): Promise<HealthResponse> {
    const response = await fetch(`${API_BASE}/health`);
    return handleResponse<HealthResponse>(response);
  },

  /**
   * List all available scenarios
   */
  async listScenarios(): Promise<ScenarioSummary[]> {
    const response = await fetch(`${API_BASE}/scenarios`);
    return handleResponse<ScenarioSummary[]>(response);
  },

  /**
   * Get detailed scenario information
   */
  async getScenario(scenarioId: string): Promise<ScenarioDetail> {
    const response = await fetch(`${API_BASE}/scenarios/${scenarioId}`);
    return handleResponse<ScenarioDetail>(response);
  },

  /**
   * Run incident analysis on a scenario
   */
  async runIncident(request: RunIncidentRequest): Promise<IncidentResponse> {
    const response = await fetch(`${API_BASE}/incidents/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    const run = await handleResponse<RunIncidentResponse>(response);
    const [report, scenario] = await Promise.all([
      api.getReport(run.run_id),
      api.getScenario(run.scenario_id),
    ]);

    const candidates = scenario.candidate_remediations.map(candidate => ({
      candidate_id: candidate.id,
      action_type: candidate.remediation_type,
      reasoning: candidate.description,
      parameters: candidate.parameters,
    }));
    const simulations = Object.fromEntries(report.simulations.map(simulation => [simulation.remediation_id, {
      ...simulation,
      proof_or_reason: simulation.reason,
      attacker_reachability_blocked: !simulation.after_reachability.is_reachable,
      business_workflows_intact: simulation.workflow_results.every(workflow => workflow.is_operational),
      broken_workflows: simulation.workflow_results
        .filter(workflow => !workflow.is_operational)
        .map(workflow => workflow.workflow_name),
    }]));
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
      events: report.events,
      workflows: scenario.workflows.map(workflow => ({
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
  },

  /**
   * Get incident report by run ID
   */
  async getReport(runId: string): Promise<EvidenceReport> {
    const response = await fetch(`${API_BASE}/incidents/${runId}/report`);
    return handleResponse<EvidenceReport>(response);
  },

  /**
   * Simulate a remediation in the digital twin
   */
  async simulate(runId: string, request: SimulateRequest): Promise<SimulateResponse> {
    const response = await fetch(`${API_BASE}/incidents/${runId}/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    return handleResponse<SimulateResponse>(response);
  },

  /**
   * Run full benchmark suite
   */
  async runBenchmark(): Promise<BenchmarkSummary> {
    const response = await fetch(`${API_BASE}/benchmark/run`, {
      method: 'POST',
    });
    return handleResponse<BenchmarkSummary>(response);
  },
};

export { ApiError };

// Utility for formatting timestamps
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
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
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function truncateArn(arn: string, maxLength = 50): string {
  if (arn.length <= maxLength) return arn;
  const parts = arn.split(':');
  if (parts.length < 3) return arn.slice(0, maxLength) + '…';
  const prefix = parts.slice(0, 3).join(':');
  const resource = parts.slice(-1)[0];
  const short = `${prefix}:…:${resource}`;
  return short.length > maxLength ? short.slice(0, maxLength) + '…' : short;
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