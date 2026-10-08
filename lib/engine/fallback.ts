/**
 * Payload generators used when the normal path cannot complete.
 *
 * Kept separate so every route can fall back to the *same* shape the happy path
 * returns — the console renders a degraded run without special-casing, instead of
 * dying on a 500.
 */

import type { EvidenceReport, ScenarioData } from './types';
import { REPORT_WARNINGS } from './types';
import { buildSyntheticScenario } from './scenarioSchema';
import { runIncidentSimulation } from './simulation';

export const EMPTY_HYPOTHESIS = {
  summary:
    'No incident data was available. The scenario pack could not be evaluated, so no attack path is claimed.',
  attack_vector: 'Unavailable',
  impacted_identities: [],
  impacted_resources: [],
  confidence: 0.0,
  evidence_event_ids: [],
  unknowns: ['Scenario engine returned no data'],
};

/** Runs the engine over `scenario`; if even that fails, returns a synthetic run. */
export function reportForScenario(
  scenario: ScenarioData,
  runId: string,
  providerMode: string
): { report: EvidenceReport; notes: string[] } {
  try {
    const outcome = runIncidentSimulation(scenario, { runId, providerMode });
    return { report: outcome.report, notes: outcome.notes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const outcome = runIncidentSimulation(buildSyntheticScenario(scenario.id), {
        runId,
        providerMode,
      });
      return {
        report: outcome.report,
        notes: [...outcome.notes, `scenario ${scenario.id} failed to simulate (${message}); ran the generated scenario instead`],
      };
    } catch (innerError) {
      return { report: emergencyReport(scenario.id, runId, providerMode, innerError), notes: [] };
    }
  }
}

/** Last resort: a structurally valid report with no claims. */
export function emergencyReport(
  scenarioId: string,
  runId: string,
  providerMode: string,
  error: unknown
): EvidenceReport {
  return {
    run_id: runId,
    scenario_id: scenarioId,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    provider_mode: providerMode,
    synthetic: true,
    events: [],
    attack_path: {
      initial_compromise: 'none',
      target_resource: 'none',
      steps: [],
      evidence_event_ids: [],
    },
    hypothesis: {
      ...EMPTY_HYPOTHESIS,
      unknowns: [
        ...EMPTY_HYPOTHESIS.unknowns,
        `simulation error: ${error instanceof Error ? error.message : String(error)}`,
      ],
    },
    simulations: [],
    warnings: [...REPORT_WARNINGS],
    degraded: true,
  };
}
