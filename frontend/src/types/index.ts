/** Frontend TypeScript Types - Mirror of Backend Pydantic Models */

export interface UserIdentity {
  type: string;
  principalId: string;
  arn: string;
  accountId?: string;
  userName?: string;
  sessionContext?: Record<string, any>;
}

export interface RawCloudTrailEvent {
  eventID: string;
  eventTime: string;
  eventName: string;
  eventSource: string;
  userIdentity: UserIdentity;
  requestParameters?: Record<string, any>;
  responseElements?: Record<string, any>;
  sourceIPAddress?: string;
  userAgent?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface CanonicalEvent {
  event_id: string;
  event_time: string;
  action: string;
  service: string;
  actor_arn: string;
  target_arn?: string;
  is_supported: boolean;
  raw_evidence: Record<string, any>;
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
  trust_policy: Record<string, any>;
  attached_policies: Record<string, any>[];
}

export interface ResourceNode {
  id: string;
  name: string;
  type: string;
  arn: string;
  is_sensitive: boolean;
  resource_policy?: Record<string, any> | null;
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

export type RemediationType =
  | 'revoke_role_sessions'
  | 'remove_resource_permission'
  | 'isolate_workload'
  | 'attach_inline_deny';

export interface RemediationCandidate {
  id: string;
  title: string;
  remediation_type: RemediationType;
  target_arn: string;
  parameters: Record<string, any>;
  description: string;
  is_broad: boolean;
}

export type SimulationStatus = 'verified' | 'rejected' | 'unverified';

export interface ReachabilityState {
  attacker_entry_arn: string;
  target_resource_arn: string;
  is_reachable: boolean;
  path_summary?: string;
}

export interface WorkflowVerification {
  workflow_id: string;
  workflow_name: string;
  is_operational: boolean;
  failure_reason?: string;
}

export interface SimulationResult {
  remediation_id: string;
  remediation_title: string;
  status: SimulationStatus;
  reason: string;
  before_reachability: ReachabilityState;
  after_reachability: ReachabilityState;
  workflow_results: WorkflowVerification[];
  proof_details: Record<string, any>;
  proof_or_reason: string;
  attacker_reachability_blocked: boolean;
  business_workflows_intact: boolean;
  broken_workflows?: string[];
}

export interface EvidenceSimulation {
  remediation_id: string;
  remediation_title: string;
  status: SimulationStatus;
  reason: string;
  before_reachability: ReachabilityState;
  after_reachability: ReachabilityState;
  workflow_results: WorkflowVerification[];
  proof_details: Record<string, any>;
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
  simulations: EvidenceSimulation[];
  benchmark_outcome?: Record<string, any>;
  warnings: string[];
}

export interface EvidenceReportView extends EvidenceReport {
  report_id: string;
  scenario_name: string;
  scenario_type: string;
  candidates: CandidateAction[];
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
}

export interface ScenarioSummary {
  scenario_id: string;
  name: string;
  description: string;
  scenario_type: string;
  event_count: number;
  workflow_count: number;
  candidate_count: number;
}

export interface ScenarioDetail extends ScenarioSummary {
  events: RawCloudTrailEvent[];
  principals: PrincipalNode[];
  roles: RoleNode[];
  resources: ResourceNode[];
  workloads: WorkloadNode[];
  workflows: BusinessWorkflow[];
  candidate_remediations: RemediationCandidate[];
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
}

export interface SimulateRequest {
  remediation_id: string;
}

export interface SimulateResponse {
  run_id: string;
  remediation_id: string;
  status: string;
  reason: string;
  before_reachability: ReachabilityState;
  after_reachability: ReachabilityState;
  workflow_results: WorkflowVerification[];
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
}

export interface CandidateAction {
  candidate_id: string;
  action_type: string;
  reasoning: string;
  parameters: Record<string, any>;
}

export interface Workflow {
  workflow_name: string;
  principal_arn: string;
  required_action: string;
  target_resource_arn: string;
}

export interface IncidentResponse {
  run_id: string;
  scenario_id: string;
  hypothesis: IncidentHypothesis;
  attack_path: AttackPath;
  events: CanonicalEvent[];
  workflows: Workflow[];
  candidates: CandidateAction[];
  simulations: Record<string, SimulationResult>;
  report: EvidenceReportView;
  scenario_detail: ScenarioDetail;
}