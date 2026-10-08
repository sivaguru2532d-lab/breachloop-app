/**
 * Deterministic Incident Graph + Attack Path tracer
 * — port of backend/breachloop/engine/graph.py
 *
 * Parity notes (deliberately preserved from the reference implementation):
 *  - `_find_path` marks nodes visited at *enqueue* time into one shared set, so it
 *    is a greedy shortest-path search rather than exhaustive path enumeration.
 *  - Trust-policy edges carry `evidence_id === "trust_policy"`, which is NOT the
 *    `"topology"` sentinel, so those steps do land in `evidence_event_ids`.
 *  Both affect confidence and benchmark scoring; changing them would silently
 *  move the benchmark, so they are replicated exactly.
 */

import type {
  AttackPath,
  BusinessWorkflow,
  CanonicalEvent,
  PrincipalNode,
  ResourceNode,
  RoleNode,
  WorkloadNode,
} from './types';

export type Edge = [source: string, target: string, action: string, evidenceEventId: string];

interface GraphNodeEntry {
  type: 'principal' | 'role' | 'resource' | 'workload';
  node: PrincipalNode | RoleNode | ResourceNode | WorkloadNode;
}

export class IncidentGraph {
  readonly nodes: Map<string, GraphNodeEntry> = new Map();
  edges: Edge[] = [];
  readonly attackerEntries: Set<string> = new Set();
  readonly sensitiveTargets: Set<string> = new Set();

  addPrincipal(principal: PrincipalNode): void {
    this.nodes.set(principal.arn, { type: 'principal', node: principal });
    if (principal.is_compromised) this.attackerEntries.add(principal.arn);
  }

  addRole(role: RoleNode): void {
    this.nodes.set(role.arn, { type: 'role', node: role });
  }

  addResource(resource: ResourceNode): void {
    this.nodes.set(resource.arn, { type: 'resource', node: resource });
    if (resource.is_sensitive) this.sensitiveTargets.add(resource.arn);
  }

  addWorkload(workload: WorkloadNode): void {
    this.nodes.set(workload.arn, { type: 'workload', node: workload });
    this.edges.push([workload.arn, workload.execution_role_arn, 'executes_as', 'topology']);
  }

  /** Adds an observed action edge from actor to target, carrying event evidence. */
  addObservedAction(event: CanonicalEvent): void {
    if (event.target_arn && event.is_supported) {
      this.edges.push([event.actor_arn, event.target_arn, event.action, event.event_id]);
    }
  }

  addCanAssume(principalArn: string, roleArn: string, eventId = 'topology'): void {
    this.edges.push([principalArn, roleArn, 'sts:AssumeRole', eventId]);
  }

  addPermission(principalArn: string, resourceArn: string, action: string, eventId = 'topology'): void {
    this.edges.push([principalArn, resourceArn, action, eventId]);
  }

  /** Every directed path from any attacker entry to any sensitive target. */
  findAttackPaths(): AttackPath[] {
    const paths: AttackPath[] = [];
    for (const entry of this.attackerEntries) {
      for (const target of this.sensitiveTargets) {
        const path = this.findPath(entry, target);
        if (path) paths.push(path);
      }
    }
    return paths;
  }

  /** BFS for the shortest directed path from `start` to `end`. */
  findPath(start: string, end: string): AttackPath | null {
    const queue: Array<[string, Edge[]]> = [[start, []]];
    const visited = new Set<string>([start]);
    let head = 0;

    while (head < queue.length) {
      const [current, pathEdges] = queue[head];
      head += 1;

      if (current === end) return this.buildAttackPath(start, end, pathEdges);

      for (const [src, dst, action, evidenceId] of this.edges) {
        if (src === current && !visited.has(dst)) {
          visited.add(dst);
          queue.push([dst, [...pathEdges, [src, dst, action, evidenceId]]]);
        }
      }
    }

    return null;
  }

  private buildAttackPath(entry: string, target: string, pathEdges: Edge[]): AttackPath {
    const steps: AttackPath['steps'] = [];
    const evidenceIds: string[] = [];

    pathEdges.forEach(([src, dst, action, evidenceId], i) => {
      steps.push({
        step_number: i + 1,
        source_node: src,
        action,
        target_node: dst,
        evidence_event_id: evidenceId,
      });
      if (evidenceId !== 'topology') evidenceIds.push(evidenceId);
    });

    return {
      initial_compromise: entry,
      target_resource: target,
      steps,
      evidence_event_ids: evidenceIds,
    };
  }

  /** Can the workflow principal still reach its target with the required action? */
  checkWorkflowReachability(
    workflow: BusinessWorkflow,
    blockedEdges?: Set<string>
  ): [operational: boolean, failureReason: string | null] {
    const blocked = blockedEdges ?? new Set<string>();

    for (const [src, dst, action] of this.edges) {
      if (
        src === workflow.principal_arn &&
        dst === workflow.target_resource_arn &&
        action === workflow.required_action
      ) {
        if (blocked.has(edgeKey(src, dst))) {
          return [false, `Edge blocked by remediation: ${src} -> ${dst}`];
        }
        return [true, null];
      }
    }

    return [
      false,
      `No path from ${workflow.principal_arn} to ${workflow.target_resource_arn} for ${workflow.required_action}`,
    ];
  }
}

/** Set members are `(src, dst)` pairs; encoded as a single string key. */
export const edgeKey = (source: string, target: string): string => `${source}\u0000${target}`;

/**
 * Builds the complete incident graph from normalized events + topology.
 *
 * Accepts `unknown` members so a malformed scenario degrades into a smaller
 * graph instead of throwing during a request.
 */
export function buildIncidentGraph(
  events: CanonicalEvent[],
  principals: PrincipalNode[],
  roles: RoleNode[],
  resources: ResourceNode[],
  workloads: WorkloadNode[],
  workflows: BusinessWorkflow[]
): IncidentGraph {
  const graph = new IncidentGraph();

  for (const p of principals) graph.addPrincipal(p);
  for (const r of roles) graph.addRole(r);
  for (const res of resources) graph.addResource(res);
  for (const w of workloads) graph.addWorkload(w);

  // Policy-derived edges from topology (trust relationships).
  for (const role of roles) {
    const trust = role.trust_policy;
    if (trust && Array.isArray((trust as Record<string, unknown>)['Statement'])) {
      for (const rawStatement of (trust as { Statement: unknown[] }).Statement) {
        if (typeof rawStatement !== 'object' || rawStatement === null) continue;
        const stmt = rawStatement as Record<string, unknown>;
        if (stmt['Effect'] !== 'Allow' || !('Action' in stmt)) continue;

        const actions = Array.isArray(stmt['Action']) ? stmt['Action'] : [stmt['Action']];
        if (actions.map(String).includes('sts:AssumeRole')) {
          for (const principalArn of extractPrincipalsFromTrust(stmt)) {
            graph.addCanAssume(principalArn, role.arn, 'trust_policy');
          }
        }
      }
    }
  }

  // Edges from observed canonical events.
  for (const event of events) graph.addObservedAction(event);

  // Baseline legitimate access: every business workflow implies its required
  // permission edge, so preservation checks never depend on observed events.
  for (const workflow of workflows) {
    graph.addPermission(
      workflow.principal_arn,
      workflow.target_resource_arn,
      workflow.required_action,
      'topology'
    );
  }

  return graph;
}

/** Extracts principal ARNs from an IAM trust policy statement. */
function extractPrincipalsFromTrust(statement: Record<string, unknown>): string[] {
  const principals: string[] = [];
  const field = statement['Principal'];
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const aws = (field as Record<string, unknown>)['AWS'];
    if (aws !== undefined) {
      if (Array.isArray(aws)) principals.push(...aws.map(String));
      else principals.push(String(aws));
    }
    // `Principal.Service` is intentionally skipped, as in the reference engine.
  }
  return principals;
}
