/**
 * Wire contract between the SOC console and the Next.js API routes.
 *
 * The domain types are owned by the engine (`lib/engine/types.ts`) and
 * re-exported here, then extended with the few shapes that only exist for the
 * browser's view model. The previous file was a hand-maintained copy of the
 * Pydantic models and had already drifted (e.g. `ScenarioDetail.events` was
 * typed `RawCloudTrailEvent[]` while the API returned canonical events, and
 * `SimulationResult` required UI-only fields the API never sends).
 */

// Imported for the field below *and* re-exported, so components can keep
// importing every wire type from one module.
import type { LaunchBriefing } from '@/lib/api/briefing';

export type { LaunchBriefing, LaunchGlyphNode, LaunchNodeKind } from '@/lib/api/briefing';

export type {
  AttackPath,
  AttackPathStep,
  BenchmarkResult,
  BenchmarkSummary,
  BusinessWorkflow,
  CanonicalEvent,
  EvidenceReport,
  IncidentHypothesis,
  PrincipalNode,
  ReachabilityState,
  RemediationCandidate,
  RemediationType,
  ResourceNode,
  RoleNode,
  ScenarioData,
  SimulationResult,
  SimulationStatus,
  TwinState,
  UserIdentity,
  WorkflowVerification,
  WorkloadNode,
} from '@/lib/engine/types';

import type {
  AttackPath,
  BusinessWorkflow,
  CanonicalEvent,
  EvidenceReport,
  IncidentHypothesis,
  PrincipalNode,
  RemediationCandidate,
  ResourceNode,
  RoleNode,
  SimulationResult,
  WorkloadNode,
} from '@/lib/engine/types';

export interface ScenarioSummary {
  scenario_id: string;
  name: string;
  description: string;
  scenario_type: string;
  event_count: number;
  workflow_count: number;
  candidate_count: number;
  /**
   * Pre-run facts derived from the pack, attached by GET /api/scenarios so the
   * launch pad can describe each environment without fetching 12 detail
   * documents. Absent on an older API, which is why every consumer treats it
   * as optional and renders the counts it does have.
   */
  briefing?: LaunchBriefing;
}

/** A scenario as the launch pad sees it. */
export type LaunchTarget = ScenarioSummary;

/**
 * Full scenario detail. `events` is the verbatim `events` array from the pack,
 * so it may be canonical-shaped (the shipped packs) or raw CloudTrail-shaped
 * (an ingested export) — the normalizer accepts both.
 */
export interface ScenarioDetail extends ScenarioSummary {
  events: Record<string, unknown>[];
  principals: PrincipalNode[];
  roles: RoleNode[];
  resources: ResourceNode[];
  workloads: WorkloadNode[];
  workflows: BusinessWorkflow[];
  candidate_remediations: RemediationCandidate[];
  ground_truth: Record<string, unknown>;
  degradation_notes?: string[];
}

export interface RunIncidentRequest {
  scenario_id: string;
  provider_mode?: 'deterministic' | 'anthropic';
}

export interface RunIncidentResponse {
  run_id: string;
  scenario_id: string;
  provider_mode: string;
  status: string;
  report?: EvidenceReport;
  scenario_detail?: ScenarioDetail;
  degraded?: boolean;
  degradation_notes?: string[];
}

export interface SimulateRequest {
  remediation_id: string;
}

export interface SimulateResponse {
  run_id: string;
  remediation_id: string;
  status: string;
  reason: string;
  before_reachability: EvidenceReport['simulations'][number]['before_reachability'];
  after_reachability: EvidenceReport['simulations'][number]['after_reachability'];
  workflow_results: EvidenceReport['simulations'][number]['workflow_results'];
  proof_details?: Record<string, unknown>;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  runtime?: string;
  provider?: string;
  scenarios?: number;
  runs_stored?: number;
  scenario_sources?: Record<string, number>;
  persistence?: { enabled: boolean; writable: boolean; path: string; note?: string };
  degradation_notes?: string[];
  detail?: string;
}

/** A simulation result enriched with the derived flags the lab renders. */
export interface UiSimulationResult extends SimulationResult {
  proof_or_reason: string;
  attacker_reachability_blocked: boolean;
  business_workflows_intact: boolean;
  broken_workflows?: string[];
}

export interface CandidateAction {
  candidate_id: string;
  action_type: string;
  reasoning: string;
  parameters: Record<string, unknown>;
}

export interface Workflow {
  workflow_name: string;
  principal_arn: string;
  required_action: string;
  target_resource_arn: string;
}

/** The report plus the presentation fields `buildIncidentResponse` adds. */
export type EvidenceReportView = EvidenceReport & {
  report_id: string;
  scenario_name: string;
  scenario_type: string;
  candidates: CandidateAction[];
};

/** Everything the SOC console renders after one run. */
export interface IncidentResponse {
  run_id: string;
  scenario_id: string;
  hypothesis: IncidentHypothesis;
  attack_path: AttackPath;
  events: CanonicalEvent[];
  workflows: Workflow[];
  candidates: CandidateAction[];
  simulations: Record<string, UiSimulationResult>;
  report: EvidenceReportView;
  scenario_detail: ScenarioDetail;
}
