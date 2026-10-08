/**
 * Incident simulation pipeline — the single code path behind `/api/incidents/run`,
 * `/api/incidents/:runId/report` and `/api/benchmark/run`.
 *
 * Purely deterministic and fully in-process, so a cold start costs microseconds
 * of CPU and there is no external dependency that can fail and 500.
 */

import { DeterministicAnalyst } from './analyst';
import { buildIncidentGraph } from './graph';
import type {
  AttackPath,
  BenchmarkResult,
  BenchmarkSummary,
  EvidenceReport,
  ScenarioData,
  SimulationResult,
} from './types';
import { BENCHMARK_DISCLAIMER, REPORT_WARNINGS } from './types';
import { normalizeEvents } from './normalizer';
import { createBaselineTwinState, DigitalTwin } from './twin';

export const EMPTY_ATTACK_PATH: AttackPath = {
  initial_compromise: 'none',
  target_resource: 'none',
  steps: [],
  evidence_event_ids: [],
};

export interface RunOutcome {
  report: EvidenceReport;
  simulations: SimulationResult[];
  attackPathCount: number;
  notes: string[];
}

/**
 * Runs normalize → graph → attack paths → hypothesis → digital twin over every
 * candidate remediation, and returns the evidence report.
 */
export function runIncidentSimulation(
  scenario: ScenarioData,
  options: { runId: string; providerMode: string; now?: Date }
): RunOutcome {
  const notes: string[] = [];
  const events = normalizeEvents(scenario.raw_events);

  for (const warning of scenario.parse_warnings) notes.push(`scenario: ${warning}`);

  const graph = buildIncidentGraph(
    events,
    scenario.principals,
    scenario.roles,
    scenario.resources,
    scenario.workloads,
    scenario.workflows
  );
  const attackPaths = graph.findAttackPaths();

  const hypothesis = new DeterministicAnalyst().analyze(
    events,
    scenario.principals,
    scenario.roles,
    scenario.resources,
    scenario.workloads,
    scenario.workflows
  );

  // Benign packs legitimately have no path; that is a result, not an error.
  const primaryAttackPath = attackPaths.length > 0 ? attackPaths[0] : EMPTY_ATTACK_PATH;
  if (attackPaths.length === 0 && scenario.scenario_type === 'attack') {
    notes.push('attack scenario produced no reachable path; hypothesis confidence falls back to 0.1');
  }

  const twin = new DigitalTwin(
    createBaselineTwinState(
      scenario.principals,
      scenario.roles,
      scenario.resources,
      scenario.workloads,
      scenario.workflows,
      events
    )
  );

  const simulations: SimulationResult[] = [];
  for (const candidate of scenario.candidate_remediations) {
    try {
      simulations.push(twin.simulate(candidate));
    } catch (error) {
      // A broken candidate degrades to `unverified`; the run still completes.
      notes.push(`candidate ${candidate.id} failed to simulate (${(error as Error).message})`);
      simulations.push({
        remediation_id: candidate.id,
        remediation_title: candidate.title,
        status: 'unverified',
        reason: 'Digital twin could not evaluate this candidate; no claim is made about its effect.',
        before_reachability: {
          attacker_entry_arn: primaryAttackPath.initial_compromise,
          target_resource_arn: primaryAttackPath.target_resource,
          is_reachable: attackPaths.length > 0,
          path_summary: 'unavailable',
        },
        after_reachability: {
          attacker_entry_arn: primaryAttackPath.initial_compromise,
          target_resource_arn: primaryAttackPath.target_resource,
          is_reachable: attackPaths.length > 0,
          path_summary: 'unavailable',
        },
        workflow_results: scenario.workflows.map((workflow) => ({
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          is_operational: true,
          failure_reason: null,
        })),
        proof_details: { error: (error as Error).message },
      });
    }
  }

  const timestamp = (options.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');

  return {
    report: {
      run_id: options.runId,
      scenario_id: scenario.id,
      timestamp,
      provider_mode: options.providerMode,
      synthetic: true,
      events,
      attack_path: primaryAttackPath,
      hypothesis,
      simulations,
      warnings: [...REPORT_WARNINGS],
    },
    simulations,
    attackPathCount: attackPaths.length,
    notes,
  };
}

/**
 * Selects the broad / narrow results exactly as the reference runner does:
 * iterate candidates, last `is_broad` wins for broad, last other wins for narrow.
 */
function pickBroadNarrow(
  scenario: ScenarioData,
  simulations: SimulationResult[]
): { broad?: SimulationResult; narrow?: SimulationResult } {
  let broad: SimulationResult | undefined;
  let narrow: SimulationResult | undefined;

  scenario.candidate_remediations.forEach((candidate, index) => {
    const simulation = simulations[index];
    if (!simulation) return;
    if (candidate.is_broad) broad = simulation;
    else narrow = simulation;
  });

  return { broad, narrow };
}

/** Benchmarks one scenario against its out-of-band ground truth labels. */
export function benchmarkScenario(scenario: ScenarioData): BenchmarkResult {
  const startedAt = performance.now();
  const outcome = runIncidentSimulation(scenario, {
    runId: `bench-${scenario.id}`,
    providerMode: 'deterministic',
  });
  const executionTime = performance.now() - startedAt;

  const groundTruth = scenario.ground_truth;

  if (scenario.scenario_type === 'benign') {
    // A benign pack passes when no attacker entry can reach a sensitive target.
    const passed = outcome.attackPathCount === 0;
    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      scenario_type: 'benign',
      broad_fix_status: 'n/a',
      narrow_fix_status: 'n/a',
      workflow_preservation_pass: passed,
      passed,
      execution_time_ms: executionTime,
    };
  }

  const { broad, narrow } = pickBroadNarrow(scenario, outcome.simulations);

  const expectedBroad = String(groundTruth['expected_broad_remediation_status'] ?? 'rejected');
  const expectedNarrow = String(groundTruth['expected_narrow_remediation_status'] ?? 'verified');
  const expectedBroken = String(groundTruth['expected_broad_remediation_broken_workflow'] ?? '');

  let broadPassed = false;
  let narrowPassed = false;
  let workflowPass = false;

  if (broad) {
    broadPassed = broad.status === expectedBroad;
    if (expectedBroken && broad.status === 'rejected') {
      const brokenIds = broad.workflow_results.filter((w) => !w.is_operational).map((w) => w.workflow_id);
      if (brokenIds.includes(expectedBroken)) workflowPass = true;
    }
  }

  if (narrow) {
    narrowPassed = narrow.status === expectedNarrow;
    if (narrow.status === 'verified') {
      workflowPass = workflowPass || narrow.workflow_results.every((w) => w.is_operational);
    }
  }

  return {
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    scenario_type: 'attack',
    broad_fix_status: `expected:${expectedBroad},actual:${broad?.status ?? 'none'}`,
    narrow_fix_status: `expected:${expectedNarrow},actual:${narrow?.status ?? 'none'}`,
    workflow_preservation_pass: workflowPass,
    passed: broadPassed && narrowPassed && workflowPass,
    execution_time_ms: executionTime,
  };
}

/**
 * Runs the whole pack. Per-scenario failures are recorded as a failing row
 * instead of aborting the request — the reference runner's behaviour, kept so a
 * single malformed scenario can never turn `/api/benchmark/run` into a 500.
 */
export function runBenchmarkSuite(
  scenarios: ScenarioData[],
  notes: string[] = []
): BenchmarkSummary {
  const results: BenchmarkResult[] = [];

  for (const scenario of scenarios) {
    try {
      results.push(benchmarkScenario(scenario));
    } catch (error) {
      notes.push(`benchmark: ${scenario.id} threw (${(error as Error).message})`);
      results.push({
        scenario_id: scenario.id,
        scenario_name: scenario.name,
        scenario_type: 'unknown',
        broad_fix_status: 'error',
        narrow_fix_status: 'error',
        workflow_preservation_pass: false,
        passed: false,
        execution_time_ms: 0,
      });
    }
  }

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;

  return {
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    total_scenarios: total,
    attack_scenarios_count: results.filter((r) => r.scenario_type === 'attack').length,
    benign_scenarios_count: results.filter((r) => r.scenario_type === 'benign').length,
    passed_scenarios: passed,
    failed_scenarios: total - passed,
    accuracy_percentage: total > 0 ? (passed / total) * 100 : 0,
    results,
    synthetic: true,
    disclaimer: BENCHMARK_DISCLAIMER,
    ...(notes.length > 0 ? { degraded: true, degradation_notes: notes } : {}),
  };
}
