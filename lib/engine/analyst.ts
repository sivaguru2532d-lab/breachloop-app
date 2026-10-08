/**
 * Deterministic Heuristic Analyst — port of backend/breachloop/engine/analyst.py
 *
 * Pure, in-process and reproducible: no LLM, no network. `provider_mode:
 * "anthropic"` is handled in the API layer, which falls back to this analyst
 * whenever no key is configured, so a missing secret degrades the response
 * instead of throwing a 500.
 */

import { buildIncidentGraph, type IncidentGraph } from './graph';
import type {
  AttackPath,
  BusinessWorkflow,
  CanonicalEvent,
  IncidentHypothesis,
  PrincipalNode,
  ResourceNode,
  RoleNode,
  WorkloadNode,
} from './types';

export class DeterministicAnalyst {
  readonly confidenceThresholds = { high: 0.85, medium: 0.6, low: 0.35 };

  analyze(
    events: CanonicalEvent[],
    principals: PrincipalNode[],
    roles: RoleNode[],
    resources: ResourceNode[],
    workloads: WorkloadNode[],
    workflows: BusinessWorkflow[]
  ): IncidentHypothesis {
    const graph = buildIncidentGraph(events, principals, roles, resources, workloads, workflows);
    const attackPaths = graph.findAttackPaths();

    if (attackPaths.length === 0) {
      return {
        summary: 'No attack path detected from compromised identities to sensitive resources.',
        attack_vector: 'None detected',
        impacted_identities: [],
        impacted_resources: [],
        confidence: 0.1,
        evidence_event_ids: [],
        unknowns: ['No sensitive resource reachability from known compromised entries'],
      };
    }

    // Shortest / most direct path is primary (first minimum, as Python's min()).
    let primaryPath = attackPaths[0];
    for (const path of attackPaths) {
      if (path.steps.length < primaryPath.steps.length) primaryPath = path;
    }
    const entryArn = primaryPath.initial_compromise;
    const targetArn = primaryPath.target_resource;

    // Compromised identities, including role sessions reached from them.
    const compromised: string[] = principals.filter((p) => p.is_compromised).map((p) => p.arn);
    for (const event of events) {
      if (compromised.includes(event.actor_arn) && event.target_arn) {
        compromised.push(event.target_arn);
      }
    }

    const reachedResources = new Set<string>();
    for (const path of attackPaths) reachedResources.add(path.target_resource);

    const confidence = this.computeConfidence(primaryPath, events);

    const allEvidence = new Set<string>();
    for (const path of attackPaths) {
      for (const id of path.evidence_event_ids) allEvidence.add(id);
    }

    const unknowns = this.determineUnknowns(events, graph, primaryPath);
    const summary = this.buildSummary(primaryPath, entryArn, targetArn);

    return {
      summary,
      attack_vector: this.classifyVector(primaryPath),
      impacted_identities: [...new Set(compromised)],
      impacted_resources: [...reachedResources],
      confidence,
      evidence_event_ids: [...allEvidence].sort(),
      unknowns,
    };
  }

  private computeConfidence(path: AttackPath, events: CanonicalEvent[]): number {
    if (path.steps.length === 0) return 0.1;

    let base = 0.7;

    // Boost for directly observed actions (not topology-inferred).
    const observedSteps = path.steps.filter((s) => s.evidence_event_id !== 'topology').length;
    if (observedSteps > 0) base += Math.min(0.2, observedSteps * 0.05);

    // Boost for privilege escalation.
    if (path.steps.some((s) => s.action.includes('AssumeRole'))) base += 0.1;

    // Penalise unsupported evidence inside the path.
    const unsupportedInPath = events.some(
      (e) => path.evidence_event_ids.includes(e.event_id) && !e.is_supported
    );
    if (unsupportedInPath) base -= 0.15;

    return Math.max(0, Math.min(1, base));
  }

  private classifyVector(path: AttackPath): string {
    if (path.steps.length === 0) return 'Unknown';

    const first = path.steps[0];
    if (first.action.includes('AssumeRole')) return `Compromised identity assumes role (${first.target_node})`;
    if (first.action.includes('GetSecretValue')) return 'Secrets exfiltration via metadata or credentials';
    if (first.action.includes('ModifyDBSnapshotAttribute')) return 'Database snapshot public sharing';
    if (first.action.includes('PutBucketPolicy')) return 'S3 bucket policy modification';
    if (first.action.includes('CreateAccessKey')) return 'IAM privilege escalation via access key creation';
    if (first.action.includes('ScheduleKeyDeletion')) return 'KMS key deletion / ransomware';
    return `Initial action: ${first.action}`;
  }

  private buildSummary(path: AttackPath, entry: string, target: string): string {
    const lastSegment = (arn: string) => arn.split('/').pop() ?? arn;
    const stepsDesc = path.steps
      .slice(0, 3)
      .map((s) => `${s.action}(${lastSegment(s.target_node)})`)
      .join(' -> ');

    return (
      `Attacker from ${lastSegment(entry)} traversed: ${stepsDesc} ` +
      `to access sensitive target ${lastSegment(target)}. ` +
      `Path contains ${path.steps.length} steps with ${path.evidence_event_ids.length} corroborating events.`
    );
  }

  private determineUnknowns(
    events: CanonicalEvent[],
    graph: IncidentGraph,
    path: AttackPath
  ): string[] {
    const unknowns: string[] = [];

    const unsupportedCount = events.filter((e) => !e.is_supported).length;
    if (unsupportedCount > 0) {
      unknowns.push(`${unsupportedCount} unsupported event types excluded from path analysis`);
    }

    if (path.steps.length === 0) unknowns.push('No attack path steps reconstructed');

    const topologyEdges = path.steps.filter((s) => s.evidence_event_id === 'topology').length;
    if (topologyEdges > 0) {
      unknowns.push(`${topologyEdges} path steps inferred from topology (not directly observed)`);
    }

    for (const event of events) {
      if (event.target_arn && !graph.nodes.has(event.target_arn)) {
        unknowns.push(`Target resource ${event.target_arn} not found in topology model`);
      }
    }

    return unknowns;
  }
}
