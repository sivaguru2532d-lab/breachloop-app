/**
 * BreachLoop engine — shared domain types.
 *
 * Single source of truth for the domain model. `lib/types.ts` (the browser wire
 * contract) re-exports these, so the SOC console and the API handlers can never
 * drift apart the way the hand-maintained Vite types had drifted from FastAPI.
 */

export type RemediationType =
  | 'revoke_role_sessions'
  | 'remove_resource_permission'
  | 'isolate_workload'
  | 'attach_inline_deny';

export type SimulationStatus = 'verified' | 'rejected' | 'unverified';

export interface UserIdentity {
  type?: string;
  principalId?: string;
  arn?: string;
  accountId?: string;
  userName?: string;
  sessionContext?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CanonicalEvent {
  event_id: string;
  event_time: string;
  action: string;
  service: string;
  actor_arn: string;
  target_arn?: string | null;
  is_supported: boolean;
  raw_evidence: Record<string, unknown>;
}

export interface PrincipalNode {
  id: string;
  name: string;
  type: string;
  arn: string;
  is_compromised: boolean;
}

export interface RoleNode {
  id: string;
  name: string;
  type: string;
  arn: string;
  trust_policy: Record<string, unknown>;
  attached_policies: Record<string, unknown>[];
}

export interface ResourceNode {
  id: string;
  name: string;
  type: string;
  arn: string;
  is_sensitive: boolean;
  resource_policy?: Record<string, unknown> | null;
}

export interface WorkloadNode {
  id: string;
  name: string;
  type: string;
  arn: string;
  execution_role_arn: string;
}

export interface BusinessWorkflow {
  id: string;
  name: string;
  description: string;
  principal_arn: string;
  required_action: string;
  target_resource_arn: string;
  criticality: string;
}

export interface AttackPathStep {
  step_number: number;
  source_node: string;
  action: string;
  target_node: string;
  evidence_event_id: string;
}

export interface AttackPath {
  initial_compromise: string;
  target_resource: string;
  steps: AttackPathStep[];
  evidence_event_ids: string[];
}

export interface IncidentHypothesis {
  summary: string;
  attack_vector: string;
  impacted_identities: string[];
  impacted_resources: string[];
  confidence: number;
  evidence_event_ids: string[];
  unknowns: string[];
}

export interface RemediationCandidate {
  id: string;
  title: string;
  remediation_type: RemediationType;
  target_arn: string;
  parameters: Record<string, unknown>;
  description: string;
  is_broad: boolean;
}

export interface ReachabilityState {
  attacker_entry_arn: string;
  target_resource_arn: string;
  is_reachable: boolean;
  path_summary?: string | null;
}

export interface WorkflowVerification {
  workflow_id: string;
  workflow_name: string;
  is_operational: boolean;
  failure_reason?: string | null;
}

export interface SimulationResult {
  remediation_id: string;
  remediation_title: string;
  status: SimulationStatus;
  reason: string;
  before_reachability: ReachabilityState;
  after_reachability: ReachabilityState;
  workflow_results: WorkflowVerification[];
  proof_details: Record<string, unknown>;
}

export interface EvidenceReport {
  run_id: string;
  scenario_id: string;
  timestamp: string;
  provider_mode: string;
  synthetic: boolean;
  events: CanonicalEvent[];
  attack_path: AttackPath;
  hypothesis: IncidentHypothesis;
  simulations: SimulationResult[];
  benchmark_outcome?: Record<string, unknown> | null;
  warnings: string[];
  /** Only set when the handler had to degrade instead of throwing. */
  degraded?: boolean;
  degradation_notes?: string[];
}

export interface ScenarioData {
  id: string;
  name: string;
  description: string;
  scenario_type: string;
  raw_events: Record<string, unknown>[];
  principals: PrincipalNode[];
  roles: RoleNode[];
  resources: ResourceNode[];
  workloads: WorkloadNode[];
  workflows: BusinessWorkflow[];
  candidate_remediations: RemediationCandidate[];
  ground_truth: Record<string, unknown>;
  /** Notes gathered while coercing an imperfect scenario file to the contract. */
  parse_warnings: string[];
}

export interface TwinState {
  principals: Record<string, PrincipalNode>;
  roles: Record<string, RoleNode>;
  resources: Record<string, ResourceNode>;
  workloads: Record<string, WorkloadNode>;
  workflows: BusinessWorkflow[];
  active_policies: Record<string, unknown>[];
  observed_events: CanonicalEvent[];
}

export interface BenchmarkResult {
  scenario_id: string;
  scenario_name: string;
  scenario_type: string;
  broad_fix_status: string;
  narrow_fix_status: string;
  workflow_preservation_pass: boolean;
  passed: boolean;
  execution_time_ms: number;
}

export interface BenchmarkSummary {
  timestamp: string;
  total_scenarios: number;
  attack_scenarios_count: number;
  benign_scenarios_count: number;
  passed_scenarios: number;
  failed_scenarios: number;
  accuracy_percentage: number;
  results: BenchmarkResult[];
  synthetic: boolean;
  disclaimer: string;
  /** Only set when the pack could not be read at all. */
  degraded?: boolean;
  degradation_notes?: string[];
}

export const REPORT_WARNINGS: string[] = [
  'SYNTHETIC SIMULATOR RESULTS ONLY: This report was produced by an in-process digital twin.',
  'Never use as production cloud authorization or real-world efficacy proof.',
];

export const BENCHMARK_DISCLAIMER =
  'SYNTHETIC BENCHMARK RESULTS ONLY: Metrics evaluated against in-process digital twin pack.';

export const REMEDIATION_TYPES: RemediationType[] = [
  'revoke_role_sessions',
  'remove_resource_permission',
  'isolate_workload',
  'attach_inline_deny',
];
