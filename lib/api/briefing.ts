/**
 * Pre-run briefing facts for a scenario pack.
 *
 * The launch pad needs to say something true about each environment before a
 * run happens, and every field here is derived from the pack itself — event
 * stream, topology sections, workflow criticality. Nothing is invented and, by
 * design, nothing from `ground_truth` is read: the expected remediation
 * verdicts are the thing the twin is about to determine, so leaking them into
 * a summary would turn the demo into an answer key. (tests/api.test.mjs pins
 * that.)
 *
 * Everything is bounded, because this rides along on GET /api/scenarios and a
 * malformed pack must not be able to inflate it into a megabyte.
 */

import { normalizeEvents } from '@/lib/engine/normalizer';
import type { CanonicalEvent, ScenarioData } from '@/lib/engine/types';

export type LaunchNodeKind = 'principal' | 'role' | 'workload' | 'resource';

export interface LaunchGlyphNode {
  kind: LaunchNodeKind;
  label: string;
  arn: string;
  compromised: boolean;
  sensitive: boolean;
}

export interface LaunchBriefing {
  services: string[];
  actions: string[];
  regions: string[];
  window: { first: string; last: string; span_minutes: number };
  identities: { principals: number; roles: number; workloads: number };
  resource_count: number;
  sensitive_resources: number;
  publicly_exposed_resources: number;
  unsupported_events: number;
  failed_events: number;
  highest_workflow_criticality: string | null;
  remediation_kinds: string[];
  /** Observed actor → target relationships, for the card's micro-topology. */
  glyph: { nodes: LaunchGlyphNode[]; links: { from: number; to: number }[] };
}

const CAP_SERVICES = 6;
const CAP_ACTIONS = 5;
const CAP_GLYPH_NODES = 6;
const CAP_LINKS = 8;

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null) : [];
}

/** `arn:aws:iam::123456789012:role/x` → { service, region, account }. */
function parseArn(arn: string): { service: string; region: string; account: string } {
  const parts = arn.split(':');
  return {
    service: parts[1] ?? '',
    region: parts[3] ?? '',
    account: parts[4] ?? '',
  };
}

/** Short human label from an ARN tail, falling back to the node's own name. */
function shortLabel(name: unknown, arn: string): string {
  const explicit = text(name);
  if (explicit) return explicit.length > 22 ? `${explicit.slice(0, 21)}…` : explicit;
  const tail = arn.split('/').pop() ?? arn.split(':').pop() ?? arn;
  return tail.length > 22 ? `${tail.slice(0, 21)}…` : tail;
}

/** A resource policy that literally allows `*` — the classic public bucket. */
function isPubliclyExposed(policy: unknown): boolean {
  const statements = records((policy as Record<string, unknown> | undefined)?.Statement ?? (policy as unknown[] | undefined));
  return statements.some((statement) => {
    if (text(statement.Effect).toLowerCase() !== 'allow') return false;
    const principal = statement.Principal;
    if (typeof principal === 'string') return principal.trim() === '*';
    if (principal && typeof principal === 'object') {
      const values = Object.values(principal as Record<string, unknown>);
      return values.some((value) => value === '*' || (Array.isArray(value) && value.includes('*')));
    }
    return false;
  });
}

const CRITICALITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

function countBy(values: string[], cap: number): string[] {
  const tally = new Map<string, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([value]) => value);
}

function canonicalEvents(scenario: ScenarioData): CanonicalEvent[] {
  try {
    return normalizeEvents(scenario.raw_events ?? []);
  } catch {
    // A pack that cannot be normalized still has to be describable.
    return [];
  }
}

/**
 * Memoized per ScenarioData object. The registry caches parsed packs for the
 * life of the process, so a warm container computes briefings once and every
 * later GET /api/scenarios is a map lookup.
 */
const cache = new WeakMap<object, LaunchBriefing>();

export function scenarioBriefing(scenario: ScenarioData): LaunchBriefing {
  const hit = cache.get(scenario as unknown as object);
  if (hit) return hit;

  const briefing = buildBriefing(scenario);
  cache.set(scenario as unknown as object, briefing);
  return briefing;
}

function buildBriefing(scenario: ScenarioData): LaunchBriefing {
  const events = canonicalEvents(scenario);
  const principals = records(scenario.principals);
  const roles = records(scenario.roles);
  const workloads = records(scenario.workloads);
  const resources = records(scenario.resources);
  const workflows = records(scenario.workflows);

  const times = events.map((event) => text(event.event_time)).filter(Boolean).sort();
  const first = times[0] ?? '';
  const last = times[times.length - 1] ?? '';
  const span = first && last ? (Date.parse(last) - Date.parse(first)) / 60000 : 0;

  const arns = new Set<string>();
  for (const event of events) {
    for (const arn of [text(event.actor_arn), text(event.target_arn)]) if (arn) arns.add(arn);
  }

  const sensitiveCount = resources.filter((resource) => resource.is_sensitive === true).length;
  const publicCount = resources.filter((resource) => isPubliclyExposed(resource.resource_policy)).length;

  // Nodes: the compromised identity first, then the roles it can reach, then
  // workloads, then resources — capped, and deduplicated by ARN so an
  // instance-profile role listed twice appears once.
  const nodes: LaunchGlyphNode[] = [];
  const indexByArn = new Map<string, number>();
  const push = (candidate: Record<string, unknown>, kind: LaunchNodeKind) => {
    if (nodes.length >= CAP_GLYPH_NODES) return;
    const arn = text(candidate.arn);
    if (!arn || indexByArn.has(arn)) return;
    indexByArn.set(arn, nodes.length);
    nodes.push({
      kind,
      label: shortLabel(candidate.name, arn),
      arn,
      compromised: candidate.is_compromised === true,
      sensitive: candidate.is_sensitive === true,
    });
  };

  for (const principal of principals) push(principal, 'principal');
  for (const role of roles) push(role, 'role');
  for (const workload of workloads) push(workload, 'workload');
  for (const resource of resources) push(resource, 'resource');

  const seenLinks = new Set<string>();
  const links: { from: number; to: number }[] = [];
  const link = (fromArn: string, toArn: string) => {
    if (links.length >= CAP_LINKS) return;
    const from = indexByArn.get(fromArn);
    const to = indexByArn.get(toArn);
    if (from === undefined || to === undefined || from === to) return;
    const key = `${from}>${to}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    links.push({ from, to });
  };

  for (const event of events) link(text(event.actor_arn), text(event.target_arn));
  // Trust relationships are graph facts, not observed calls, so they are added
  // after the event edges and share the same cap.
  for (const role of roles) {
    const trusted = records((role.trust_policy as Record<string, unknown> | undefined)?.Statement);
    for (const statement of trusted) {
      const principal = statement.Principal as Record<string, unknown> | undefined;
      const aws = principal?.AWS ?? principal;
      const values = Array.isArray(aws) ? aws : [aws];
      for (const value of values) {
        // Trust statements are either an ARN string, `{ AWS: "arn…" }`, or
        // `{ AWS: ["arn…"] }`; accept all three without assuming.
        const arn = typeof value === 'string' ? value : text((value as Record<string, unknown> | undefined)?.AWS);
        const nested = arn || (value && typeof value === 'object' ? text((value as Record<string, unknown>).aws) : '');
        if (nested) link(nested, text(role.arn));
      }
    }
  }

  let criticality: string | null = null;
  let bestRank = -1;
  for (const workflow of workflows) {
    const label = text(workflow.criticality).toLowerCase();
    const rank = CRITICALITY_RANK[label] ?? -1;
    if (rank > bestRank) {
      bestRank = rank;
      criticality = rank >= 0 ? label.toUpperCase() : text(workflow.criticality).toUpperCase() || null;
    }
  }

  return {
    // 'unknown' is what the normalizer calls an event it could not place; a
    // card listing "unknown" as an AWS service would be a made-up fact.
    services: countBy(events.map((event) => text(event.service)).filter((service) => service && service !== 'unknown'), CAP_SERVICES),
    actions: countBy(events.map((event) => text(event.action)).filter(Boolean), CAP_ACTIONS),
    regions: countBy([...arns].map((arn) => parseArn(arn).region).filter(Boolean), 3),
    window: { first, last, span_minutes: Number.isFinite(span) ? Math.max(0, Math.round(span)) : 0 },
    identities: { principals: principals.length, roles: roles.length, workloads: workloads.length },
    resource_count: resources.length,
    sensitive_resources: sensitiveCount,
    publicly_exposed_resources: publicCount,
    unsupported_events: events.filter((event) => event.is_supported === false).length,
    failed_events: events.filter((event) => {
      const evidence = event.raw_evidence as Record<string, unknown> | undefined;
      return Boolean(evidence && (evidence.errorCode || evidence.error_message));
    }).length,
    highest_workflow_criticality: criticality,
    remediation_kinds: [...new Set(records(scenario.candidate_remediations).map((row) => text(row.remediation_type)).filter(Boolean))].slice(0, 4),
    glyph: { nodes, links },
  };
}

/**
 * Pure so the filtering the pad performs in the browser is directly testable
 * without a DOM: name, description, service, action or a resource name.
 */
export interface LaunchFilterState {
  query: string;
  scope: 'all' | 'attack' | 'benign' | 'sensitive';
}

export function filterLaunchTargets<T extends { scenario_id: string; name: string; description: string; scenario_type: string; briefing?: LaunchBriefing }>(
  targets: T[],
  state: LaunchFilterState
): T[] {
  const list = Array.isArray(targets) ? targets : [];
  const scope = state?.scope ?? 'all';
  const query = text(state?.query).trim().toLowerCase();

  const scoped = list.filter((target) => {
    if (!target) return false;
    if (scope === 'attack') return target.scenario_type === 'attack';
    if (scope === 'benign') return target.scenario_type !== 'attack';
    if (scope === 'sensitive') return (target.briefing?.sensitive_resources ?? 0) > 0 || (target.briefing?.publicly_exposed_resources ?? 0) > 0;
    return true;
  });

  if (!query) return scoped;

  return scoped.filter((target) => {
    const briefing = target.briefing;
    const haystack = [
      target.scenario_id,
      target.name,
      target.description,
      ...(briefing?.services ?? []),
      ...(briefing?.actions ?? []),
      ...(briefing?.regions ?? []),
      ...(briefing?.remediation_kinds ?? []),
      ...(briefing?.glyph.nodes ?? []).map((node) => node.label),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}
