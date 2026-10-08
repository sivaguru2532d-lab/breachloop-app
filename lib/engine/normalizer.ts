/**
 * CloudTrail Event Normalizer — port of backend/breachloop/ingestion/normalizer.py
 */

import type { CanonicalEvent } from './types';

export const KNOWN_ACTIONS: Record<string, string> = {
  AssumeRole: 'sts:AssumeRole',
  GetObject: 's3:GetObject',
  PutObject: 's3:PutObject',
  PutBucketPolicy: 's3:PutBucketPolicy',
  GetSecretValue: 'secretsmanager:GetSecretValue',
  CreateAccessKey: 'iam:CreateAccessKey',
  AttachUserPolicy: 'iam:AttachUserPolicy',
  ModifyDBSnapshotAttribute: 'rds:ModifyDBSnapshotAttribute',
  ScheduleKeyDeletion: 'kms:ScheduleKeyDeletion',
  DisableKey: 'kms:DisableKey',
  RunInstances: 'ec2:RunInstances',
  DescribeInstances: 'ec2:DescribeInstances',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Normalizes a single event into a CanonicalEvent.
 *
 * Accepts both input shapes:
 *  - canonical (scenario packs): `event_id` / `action` / `actor_arn`, passed through as-is
 *  - raw CloudTrail: `eventID` / `eventName` / `userIdentity`, mapped + evidence-preserving
 *
 * Unknown actions are flagged `is_supported: false` rather than dropped, so the
 * analyst can report them as unknowns instead of the request failing.
 */
export function normalizeSingleEvent(raw: unknown): CanonicalEvent {
  const event = isRecord(raw) ? raw : {};

  // Already-canonical events pass through directly.
  if ('event_id' in event && 'action' in event && !('eventID' in event)) {
    return {
      event_id: String(event['event_id']),
      event_time: String(event['event_time'] ?? '1970-01-01T00:00:00Z'),
      action: String(event['action']),
      service: String(event['service'] ?? ''),
      actor_arn: String(event['actor_arn'] ?? ''),
      target_arn: event['target_arn'] ? String(event['target_arn']) : null,
      is_supported: Boolean(event['is_supported'] ?? true),
      raw_evidence: isRecord(event['raw_evidence']) ? { ...event['raw_evidence'] } : {},
    };
  }

  const eventId = event['eventID'] ?? 'missing-id';
  const eventTime = event['eventTime'] ?? '1970-01-01T00:00:00Z';
  const eventName = event['eventName'] ?? '';
  const eventSource = event['eventSource'] ?? '';

  const userIdentity = isRecord(event['userIdentity']) ? event['userIdentity'] : {};
  let actorArn = userIdentity['arn'] ?? '';
  if (!actorArn && userIdentity['principalId']) actorArn = userIdentity['principalId'];

  const requestParams = isRecord(event['requestParameters']) ? event['requestParameters'] : {};
  const responseElems = isRecord(event['responseElements']) ? event['responseElements'] : {};

  // Target ARN resolution heuristic across AWS services.
  let targetArn: string | null = null;
  if ('roleArn' in requestParams) {
    targetArn = String(requestParams['roleArn']);
  } else if ('bucketName' in requestParams) {
    const bucket = requestParams['bucketName'];
    const key = requestParams['key'] ?? '';
    targetArn = `arn:aws:s3:::${bucket}/${key}`.replace(/\/+$/, '');
  } else if ('secretId' in requestParams) {
    targetArn = String(requestParams['secretId']);
  } else if ('dbSnapshotIdentifier' in requestParams) {
    targetArn = String(requestParams['dbSnapshotIdentifier']);
  } else if ('keyId' in requestParams) {
    targetArn = String(requestParams['keyId']);
  } else if ('targetArn' in requestParams) {
    targetArn = String(requestParams['targetArn']);
  }

  const supportedAction = Object.prototype.hasOwnProperty.call(KNOWN_ACTIONS, String(eventName));
  const noError = !('errorCode' in event) || event['errorCode'] === null || event['errorCode'] === undefined;
  const isSupported = supportedAction && Boolean(actorArn) && noError;

  const action = KNOWN_ACTIONS[String(eventName)] ?? `unsupported:${eventName}`;

  const rawEvidence: Record<string, unknown> = {
    eventID: eventId,
    eventTime,
    eventName,
    eventSource,
    userIdentity,
    requestParameters: requestParams,
    responseElements: responseElems,
    sourceIPAddress: event['sourceIPAddress'] ?? null,
    userAgent: event['userAgent'] ?? null,
    errorCode: event['errorCode'] ?? null,
    errorMessage: event['errorMessage'] ?? null,
  };

  return {
    event_id: String(eventId),
    event_time: String(eventTime),
    action,
    service: String(eventSource),
    actor_arn: String(actorArn),
    target_arn: targetArn,
    is_supported: isSupported,
    raw_evidence: rawEvidence,
  };
}

/** Normalizes a list of raw event dictionaries, sorted chronologically. */
export function normalizeEvents(rawEvents: unknown[]): CanonicalEvent[] {
  const canonicalList = (Array.isArray(rawEvents) ? rawEvents : []).map(normalizeSingleEvent);
  return [...canonicalList].sort((a, b) => (a.event_time < b.event_time ? -1 : a.event_time > b.event_time ? 1 : 0));
}
