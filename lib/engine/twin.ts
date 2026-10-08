/**
 * Digital Twin Simulator — port of backend/breachloop/engine/twin.py
 *
 * In-process state machine: deep-clones the baseline topology, applies a typed
 * remediation action, then re-derives attacker reachability and business
 * workflow health. The answer is a *proof*, not a guess: a candidate is only
 * `verified` when it both severs the attack path and leaves every workflow up.
 */

import { buildIncidentGraph, edgeKey, type IncidentGraph } from './graph';
import type {
  BusinessWorkflow,
  CanonicalEvent,
  PrincipalNode,
  RemediationCandidate,
  ResourceNode,
  RoleNode,
  SimulationResult,
  SimulationStatus,
  ReachabilityState,
  TwinState,
  WorkflowVerification,
  WorkloadNode,
} from './types';

const clone = <T>(value: T): T => {
  // structuredClone exists on Node 17+ / all modern browsers; JSON fallback keeps
  // a runtime without it from throwing inside a request handler.
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(value ?? null)) as T;
};

export class DigitalTwin {
  constructor(private readonly baseline: TwinState) {}

  simulate(candidate: RemediationCandidate): SimulationResult {
    const twinState = this.deepCloneState(this.baseline);
    const before = this.computeReachability(twinState);
    const blockedEdges = this.applyRemediation(twinState, candidate);
    const after = this.computeReachability(twinState, blockedEdges);
    const workflowResults = this.verifyWorkflows(twinState, blockedEdges);
    const [status, reason] = this.determineStatus(candidate, before, after, workflowResults);
    const proof = this.buildProof(candidate, twinState, before, after, workflowResults);

    return {
      remediation_id: candidate.id,
      remediation_title: candidate.title,
      status,
      reason,
      before_reachability: before,
      after_reachability: after,
      workflow_results: workflowResults,
      proof_details: proof,
    };
  }

  private deepCloneState(state: TwinState): TwinState {
    return {
      principals: clone(state.principals),
      roles: clone(state.roles),
      resources: clone(state.resources),
      workloads: clone(state.workloads),
      workflows: clone(state.workflows),
      active_policies: clone(state.active_policies),
      observed_events: clone(state.observed_events),
    };
  }

  /** Applies a typed remediation action to the cloned state; returns blocked edges. */
  private applyRemediation(state: TwinState, candidate: RemediationCandidate): Set<string> {
    switch (candidate.remediation_type) {
      case 'revoke_role_sessions':
        return this.applyRevokeRoleSessions(state, candidate);
      case 'remove_resource_permission':
        return this.applyRemoveResourcePermission(state, candidate);
      case 'isolate_workload':
        return this.applyIsolateWorkload(state, candidate);
      case 'attach_inline_deny':
        return this.applyRemoveResourcePermission(state, candidate);
      default:
        // Unknown action type — leaves the path intact, which resolves to
        // `rejected`/`unverified` rather than an exception.
        return new Set<string>();
    }
  }

  /**
   * Revoke role sessions — blocks edges INTO and OUT OF the target role.
   * Existing sessions can no longer act, and no principal can open a new session.
   */
  private applyRevokeRoleSessions(state: TwinState, candidate: RemediationCandidate): Set<string> {
    const params = candidate.parameters ?? {};
    const targetArn = String(params['role_arn'] ?? candidate.target_arn);
    const blocked = new Set<string>();

    if (!(targetArn in state.roles)) return blocked;

    const graph = this.buildGraphFromState(state);
    for (const [src, dst] of graph.edges) {
      if (src === targetArn) blocked.add(edgeKey(src, dst));
    }
    for (const arn of [...Object.keys(state.principals), ...Object.keys(state.roles)]) {
      blocked.add(edgeKey(arn, targetArn));
    }

    return blocked;
  }

  /** Removes a resource permission — blocks exactly one principal/action/resource edge. */
  private applyRemoveResourcePermission(
    _state: TwinState,
    candidate: RemediationCandidate
  ): Set<string> {
    const params = candidate.parameters ?? {};
    const blocked = new Set<string>();

    const deniedPrincipal = params['denied_principal_arn'];
    const deniedAction = params['denied_action'];
    const deniedResource = params['denied_resource_arn'] ?? candidate.target_arn;

    if (deniedPrincipal && deniedAction && deniedResource) {
      blocked.add(edgeKey(String(deniedPrincipal), String(deniedResource)));
    }

    return blocked;
  }

  /** Isolates a workload — blocks its execution-role edge. */
  private applyIsolateWorkload(state: TwinState, candidate: RemediationCandidate): Set<string> {
    const blocked = new Set<string>();
    const params = candidate.parameters ?? {};
    const workloadArn = String(params['workload_arn'] ?? candidate.target_arn);

    if (workloadArn in state.workloads) {
      const roleArn = state.workloads[workloadArn].execution_role_arn;
      blocked.add(edgeKey(workloadArn, roleArn));
    }

    return blocked;
  }

  /**
   * Attacker-to-target reachability. When `blockedEdges` is supplied those edges
   * are removed first, so remediation effects are reflected in the result.
   */
  private computeReachability(state: TwinState, blockedEdges?: Set<string>): ReachabilityState {
    const graph = this.buildGraphFromState(state);
    if (blockedEdges && blockedEdges.size > 0) {
      graph.edges = graph.edges.filter(([src, dst]) => !blockedEdges.has(edgeKey(src, dst)));
    }
    const attackPaths = graph.findAttackPaths();

    if (attackPaths.length > 0) {
      const primary = attackPaths[0];
      return {
        attacker_entry_arn: primary.initial_compromise,
        target_resource_arn: primary.target_resource,
        is_reachable: true,
        path_summary: `Path length ${primary.steps.length} steps via ${primary.steps
          .map((s) => s.action)
          .join(' -> ')}`,
      };
    }

    const attacker = graph.attackerEntries.size ? [...graph.attackerEntries][0] : 'unknown';
    const target = graph.sensitiveTargets.size ? [...graph.sensitiveTargets][0] : 'unknown';
    return {
      attacker_entry_arn: attacker,
      target_resource_arn: target,
      is_reachable: false,
      path_summary: 'No path from attacker to sensitive resource',
    };
  }

  private buildGraphFromState(state: TwinState): IncidentGraph {
    return buildIncidentGraph(
      [...state.observed_events],
      Object.values(state.principals),
      Object.values(state.roles),
      Object.values(state.resources),
      Object.values(state.workloads),
      state.workflows
    );
  }

  private verifyWorkflows(state: TwinState, blockedEdges: Set<string>): WorkflowVerification[] {
    const results: WorkflowVerification[] = [];
    const graph = this.buildGraphFromState(state);

    for (const workflow of state.workflows) {
      const [isOperational, failureReason] = graph.checkWorkflowReachability(workflow, blockedEdges);
      results.push({
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        is_operational: isOperational,
        failure_reason: failureReason,
      });
    }

    return results;
  }

  private determineStatus(
    _candidate: RemediationCandidate,
    _before: ReachabilityState,
    after: ReachabilityState,
    workflows: WorkflowVerification[]
  ): [SimulationStatus, string] {
    const attackerStopped = !after.is_reachable;
    const broken = workflows.filter((w) => !w.is_operational);

    if (!attackerStopped) return ['rejected', 'Attack path remains reachable after remediation'];

    if (broken.length > 0) {
      const names = broken.map((w) => w.workflow_name).join(', ');
      return ['rejected', `Disrupts business workflow(s): ${names}`];
    }

    return ['verified', 'Attack reachability blocked, all business workflows preserved'];
  }

  private buildProof(
    candidate: RemediationCandidate,
    _state: TwinState,
    before: ReachabilityState,
    after: ReachabilityState,
    workflows: WorkflowVerification[]
  ): Record<string, unknown> {
    const broken = workflows.filter((w) => !w.is_operational);
    const operational = workflows.filter((w) => w.is_operational);

    return {
      remediation_type: candidate.remediation_type,
      target_arn: candidate.target_arn,
      parameters: candidate.parameters ?? {},
      before: { attacker_reachable: before.is_reachable, path: before.path_summary },
      after: { attacker_reachable: after.is_reachable, path: after.path_summary },
      workflows: {
        operational: operational.map((w) => w.workflow_name),
        broken: broken.map((w) => ({ name: w.workflow_name, reason: w.failure_reason })),
      },
      is_broad_fix: candidate.is_broad,
    };
  }
}

/** Baseline TwinState from scenario topology + observed events. */
export function createBaselineTwinState(
  principals: PrincipalNode[],
  roles: RoleNode[],
  resources: ResourceNode[],
  workloads: WorkloadNode[],
  workflows: BusinessWorkflow[],
  events: CanonicalEvent[] = []
): TwinState {
  return {
    principals: Object.fromEntries(principals.map((p) => [p.arn, p])),
    roles: Object.fromEntries(roles.map((r) => [r.arn, r])),
    resources: Object.fromEntries(resources.map((r) => [r.arn, r])),
    workloads: Object.fromEntries(workloads.map((w) => [w.arn, w])),
    workflows,
    active_policies: [],
    observed_events: [...events],
  };
}
