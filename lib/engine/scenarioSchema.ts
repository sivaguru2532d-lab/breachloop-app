/**
 * Scenario store — replacement for `backend/breachloop/ingestion/loader.py`.
 *
 * Three-tier resolution, in priority order:
 *   1. `BREACHLOOP_SCENARIOS_DIR` / `./scenarios` on disk (lets you drop in a new pack)
 *   2. the pack statically imported below (always traced into the serverless bundle)
 *   3. a generated synthetic scenario, so the API still answers 200 with a valid
 *      payload even if the data layer is entirely gone
 *
 * Tier 3 is the fix for the class of fault that produced HTTP 500s: the old
 * loader raised FileNotFoundError/ValidationError straight out of the handler.
 */

import type {
  BusinessWorkflow,
  PrincipalNode,
  RemediationCandidate,
  RemediationType,
  ResourceNode,
  RoleNode,
  ScenarioData,
  WorkloadNode,
} from './types';
import { REMEDIATION_TYPES } from './types';

export type { ScenarioData } from './types';

import compromisedRole from '@/scenarios/compromised-role.json';
import stsPivotExfil from '@/scenarios/sts-pivot-exfil.json';
import snapshotShare from '@/scenarios/snapshot-share.json';
import kmsRansomware from '@/scenarios/kms-ransomware.json';
import secretLeakCicd from '@/scenarios/secret-leak-cicd.json';
import bucketPolicyTamper from '@/scenarios/bucket-policy-tamper.json';
import instanceProfileSsrf from '@/scenarios/instance-profile-ssrf.json';
import benignNightlyEtl from '@/scenarios/benign-nightly-etl.json';
import benignKeyRotation from '@/scenarios/benign-key-rotation.json';
import benignPublicAssetPublish from '@/scenarios/benign-public-asset-publish.json';
import benignOncallTriage from '@/scenarios/benign-oncall-triage.json';
import benignReleasePromotion from '@/scenarios/benign-release-promotion.json';

/** Statically bundled so Vercel's tracer always ships the pack with the API. */
export const BUNDLED_SCENARIOS: Record<string, unknown> = {
  'compromised-role': compromisedRole,
  'sts-pivot-exfil': stsPivotExfil,
  'snapshot-share': snapshotShare,
  'kms-ransomware': kmsRansomware,
  'secret-leak-cicd': secretLeakCicd,
  'bucket-policy-tamper': bucketPolicyTamper,
  'instance-profile-ssrf': instanceProfileSsrf,
  'benign-nightly-etl': benignNightlyEtl,
  'benign-key-rotation': benignKeyRotation,
  'benign-public-asset-publish': benignPublicAssetPublish,
  'benign-oncall-triage': benignOncallTriage,
  'benign-release-promotion': benignReleasePromotion,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter(isRecord) as Record<string, unknown>[]) : [];

const str = (obj: Record<string, unknown>, key: string, fallback = ''): string => {
  const value = obj[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
};

const asBool = (obj: Record<string, unknown>, key: string, fallback = false): boolean => {
  const value = obj[key];
  return typeof value === 'boolean' ? value : fallback;
};

// ── per-node coercion (never throws; bad members are skipped with a warning) ──
function toPrincipal(raw: Record<string, unknown>, warnings: string[]): PrincipalNode | null {
  const arn = str(raw, 'arn') || str(raw, 'id');
  if (!arn) {
    warnings.push('skipped a principal node without an `arn`');
    return null;
  }
  return {
    id: str(raw, 'id', arn),
    name: str(raw, 'name', arn.split('/').pop() ?? arn),
    type: str(raw, 'type', 'Principal'),
    arn,
    is_compromised: asBool(raw, 'is_compromised'),
  };
}

function toRole(raw: Record<string, unknown>, warnings: string[]): RoleNode | null {
  const arn = str(raw, 'arn') || str(raw, 'id');
  if (!arn) {
    warnings.push('skipped a role without an `arn`');
    return null;
  }
  return {
    id: str(raw, 'id', arn),
    name: str(raw, 'name', arn.split('/').pop() ?? arn),
    type: str(raw, 'type', 'Role'),
    arn,
    trust_policy: isRecord(raw['trust_policy']) ? (raw['trust_policy'] as Record<string, unknown>) : {},
    attached_policies: Array.isArray(raw['attached_policies'])
      ? (raw['attached_policies'].filter(isRecord) as Record<string, unknown>[])
      : [],
  };
}

function toResource(raw: Record<string, unknown>, warnings: string[]): ResourceNode | null {
  const arn = str(raw, 'arn') || str(raw, 'id');
  if (!arn) {
    warnings.push('skipped a resource without an `arn`');
    return null;
  }
  return {
    id: str(raw, 'id', arn),
    name: str(raw, 'name', arn.split('/').pop() ?? arn),
    type: str(raw, 'type', 'Resource'),
    arn,
    is_sensitive: asBool(raw, 'is_sensitive'),
    resource_policy: isRecord(raw['resource_policy']) ? (raw['resource_policy'] as Record<string, unknown>) : null,
  };
}

function toWorkload(raw: Record<string, unknown>, warnings: string[]): WorkloadNode | null {
  const arn = str(raw, 'arn') || str(raw, 'id');
  if (!arn) {
    warnings.push('skipped a workload without an `arn`');
    return null;
  }
  const executionRole = str(raw, 'execution_role_arn');
  if (!executionRole) warnings.push(`workload ${arn} has no execution_role_arn`);
  return {
    id: str(raw, 'id', arn),
    name: str(raw, 'name', arn.split('/').pop() ?? arn),
    type: str(raw, 'type', 'Workload'),
    arn,
    execution_role_arn: executionRole,
  };
}

function toWorkflow(raw: Record<string, unknown>, warnings: string[]): BusinessWorkflow | null {
  const id = str(raw, 'id');
  const principalArn = str(raw, 'principal_arn');
  const target = str(raw, 'target_resource_arn');
  const action = str(raw, 'required_action');
  if (!id || !principalArn || !target || !action) {
    warnings.push('skipped a business workflow missing id/principal_arn/required_action/target_resource_arn');
    return null;
  }
  return {
    id,
    name: str(raw, 'name', id),
    description: str(raw, 'description'),
    principal_arn: principalArn,
    required_action: action,
    target_resource_arn: target,
    criticality: str(raw, 'criticality', 'High'),
  };
}

function toCandidate(raw: Record<string, unknown>, index: number, warnings: string[]): RemediationCandidate | null {
  const id = str(raw, 'id', `fix-candidate-${index + 1}`);
  const declared = str(raw, 'remediation_type');
  const type = (REMEDIATION_TYPES as string[]).includes(declared)
    ? (declared as RemediationType)
    : 'remove_resource_permission';
  if (declared && type !== declared) {
    // Pydantic rejected the whole request here; we coerce and record it instead.
    warnings.push(`candidate ${id}: unknown remediation_type "${declared}", coerced to remove_resource_permission`);
  }
  return {
    id,
    title: str(raw, 'title', id),
    remediation_type: type,
    target_arn: str(raw, 'target_arn'),
    parameters: isRecord(raw['parameters']) ? (raw['parameters'] as Record<string, unknown>) : {},
    description: str(raw, 'description'),
    is_broad: asBool(raw, 'is_broad'),
  };
}

/** Validates + coerces an arbitrary JSON document into the scenario contract. */
export function toScenarioData(raw: unknown, fallbackId: string): ScenarioData {
  const warnings: string[] = [];
  const doc = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) warnings.push('scenario document was not a JSON object; using empty scenario');

  const map = <T>(list: Record<string, unknown>[], conv: (r: Record<string, unknown>, w: string[]) => T | null): T[] => {
    const out: T[] = [];
    for (const item of list) {
      const value = conv(item, warnings);
      if (value) out.push(value);
    }
    return out;
  };

  return {
    id: str(doc, 'id', fallbackId) || fallbackId,
    name: str(doc, 'name', fallbackId),
    description: str(doc, 'description'),
    scenario_type: str(doc, 'scenario_type', 'attack'),
    raw_events: asArray(doc['events']),
    principals: map(asArray(doc['principals']), toPrincipal),
    roles: map(asArray(doc['roles']), toRole),
    resources: map(asArray(doc['resources']), toResource),
    workloads: map(asArray(doc['workloads']), toWorkload),
    workflows: map(asArray(doc['workflows']), toWorkflow),
    candidate_remediations: asArray(doc['candidate_remediations'])
      .map((raw, index) => toCandidate(raw, index, warnings))
      .filter((c): c is RemediationCandidate => c !== null),
    ground_truth: isRecord(doc['ground_truth']) ? (doc['ground_truth'] as Record<string, unknown>) : {},
    parse_warnings: warnings,
  };
}

/**
 * Last-resort scenario, produced in code. Used only when neither disk nor the
 * bundled pack yields anything — the response is still a valid 200 payload that
 * the SOC console can render end to end.
 */
export function buildSyntheticScenario(id = 'synthetic-fallback'): ScenarioData {
  const account = '123456789012';
  const roleArn = `arn:aws:iam::${account}:role/GeneratedRole`;
  const userArn = `arn:aws:iam::${account}:user/generated-analyst`;
  const bucketArn = 'arn:aws:s3:::generated-sensitive-bucket';

  return toScenarioData(
    {
      id,
      name: 'Generated Demo Scenario',
      description:
        'No scenario pack was available, so this minimal compromised-role scenario was generated in-process to keep the console operational.',
      scenario_type: 'attack',
      events: [
        {
          event_id: 'gen-01',
          event_time: '2026-01-01T00:00:00Z',
          action: 'sts:AssumeRole',
          service: 'sts',
          actor_arn: userArn,
          target_arn: roleArn,
          is_supported: true,
          raw_evidence: { generated: true },
        },
        {
          event_id: 'gen-02',
          event_time: '2026-01-01T00:01:00Z',
          action: 's3:GetObject',
          service: 's3',
          actor_arn: roleArn,
          target_arn: bucketArn,
          is_supported: true,
          raw_evidence: { generated: true },
        },
      ],
      principals: [{ id: 'gen-principal', name: 'generated-analyst', arn: userArn, is_compromised: true }],
      roles: [
        {
          id: 'gen-role',
          name: 'GeneratedRole',
          arn: roleArn,
          trust_policy: {
            Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: userArn } }],
          },
        },
      ],
      resources: [{ id: 'gen-bucket', name: 'Generated Bucket', arn: bucketArn, is_sensitive: true }],
      workloads: [],
      workflows: [
        {
          id: 'gen-workflow',
          name: 'Generated Workflow',
          description: 'Reads a non-sensitive object to demonstrate workflow preservation.',
          principal_arn: roleArn,
          required_action: 's3:PutObject',
          target_resource_arn: 'arn:aws:s3:::generated-public-bucket',
          criticality: 'Medium',
        },
      ],
      candidate_remediations: [
        {
          id: 'fix-broad-01',
          title: 'Revoke all active sessions on the role',
          remediation_type: 'revoke_role_sessions',
          target_arn: roleArn,
          parameters: { role_arn: roleArn },
          description: 'Stop every session on the generated role.',
          is_broad: true,
        },
        {
          id: 'fix-narrow-01',
          title: 'Deny object reads on the generated bucket',
          remediation_type: 'remove_resource_permission',
          target_arn: bucketArn,
          parameters: {
            denied_principal_arn: roleArn,
            denied_action: 's3:GetObject',
            denied_resource_arn: bucketArn,
          },
          description: 'Scoped deny that leaves the write workflow intact.',
          is_broad: false,
        },
      ],
      ground_truth: {
        expected_broad_remediation_status: 'rejected',
        expected_narrow_remediation_status: 'verified',
      },
    },
    id
  );
}
