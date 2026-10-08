/**
 * Shared response serializers, so `/api/scenarios/:id` and the inline
 * `scenario_detail` returned by `/api/incidents/run` cannot drift apart.
 */

import type { ScenarioData } from '@/lib/engine/types';

export function scenarioDetail(scenario: ScenarioData, notes: string[] = []) {
  return {
    scenario_id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    scenario_type: scenario.scenario_type,
    event_count: scenario.raw_events.length,
    workflow_count: scenario.workflows.length,
    candidate_count: scenario.candidate_remediations.length,
    events: scenario.raw_events,
    principals: scenario.principals,
    roles: scenario.roles,
    resources: scenario.resources,
    workloads: scenario.workloads,
    workflows: scenario.workflows,
    candidate_remediations: scenario.candidate_remediations,
    ground_truth: scenario.ground_truth,
    synthetic: true,
    ...(notes.length > 0 ? { degradation_notes: notes } : {}),
  };
}
