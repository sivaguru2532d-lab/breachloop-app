"""CloudTrail Event Normalizer."""

from typing import List, Dict, Any
from breachloop.models import CanonicalEvent, RawCloudTrailEvent, UserIdentity


KNOWN_ACTIONS = {
    "AssumeRole": "sts:AssumeRole",
    "GetObject": "s3:GetObject",
    "PutObject": "s3:PutObject",
    "PutBucketPolicy": "s3:PutBucketPolicy",
    "GetSecretValue": "secretsmanager:GetSecretValue",
    "CreateAccessKey": "iam:CreateAccessKey",
    "AttachUserPolicy": "iam:AttachUserPolicy",
    "ModifyDBSnapshotAttribute": "rds:ModifyDBSnapshotAttribute",
    "ScheduleKeyDeletion": "kms:ScheduleKeyDeletion",
    "DisableKey": "kms:DisableKey",
    "RunInstances": "ec2:RunInstances",
    "DescribeInstances": "ec2:DescribeInstances",
}


def normalize_single_event(raw: Dict[str, Any]) -> CanonicalEvent:
    """Normalizes a single event dictionary into a CanonicalEvent.

    Supports two input shapes:
    - Canonical (scenario files): keys like event_id / event_time / action / actor_arn
      are preserved as-is (is_supported defaults to True when omitted).
    - Raw CloudTrail: keys like eventID / eventTime / eventName / userIdentity.

    Preserves original eventID as event_id. Preserves raw fields under raw_evidence.
    Flags unknown/unsupported events as is_supported=False.
    """
    # Already-canonical events (scenario JSON "events" arrays) pass through directly.
    if "event_id" in raw and "action" in raw and "eventID" not in raw:
        return CanonicalEvent(
            event_id=str(raw["event_id"]),
            event_time=str(raw.get("event_time", "1970-01-01T00:00:00Z")),
            action=str(raw["action"]),
            service=str(raw.get("service", "")),
            actor_arn=str(raw.get("actor_arn", "")),
            target_arn=str(raw["target_arn"]) if raw.get("target_arn") else None,
            is_supported=bool(raw.get("is_supported", True)),
            raw_evidence=dict(raw.get("raw_evidence", {}) or {}),
        )

    event_id = raw.get("eventID", "missing-id")
    event_time = raw.get("eventTime", "1970-01-01T00:00:00Z")
    event_name = raw.get("eventName", "")
    event_source = raw.get("eventSource", "")

    user_identity = raw.get("userIdentity", {})
    actor_arn = user_identity.get("arn", "")
    if not actor_arn and user_identity.get("principalId"):
        actor_arn = user_identity.get("principalId")

    request_params = raw.get("requestParameters", {}) or {}
    response_elems = raw.get("responseElements", {}) or {}

    # Target ARN resolution heuristic across AWS services
    target_arn = None
    if "roleArn" in request_params:
        target_arn = request_params["roleArn"]
    elif "bucketName" in request_params:
        bucket = request_params["bucketName"]
        key = request_params.get("key", "")
        target_arn = f"arn:aws:s3:::{bucket}/{key}".rstrip("/")
    elif "secretId" in request_params:
        target_arn = request_params["secretId"]
    elif "dbSnapshotIdentifier" in request_params:
        target_arn = request_params["dbSnapshotIdentifier"]
    elif "keyId" in request_params:
        target_arn = request_params["keyId"]
    elif "targetArn" in request_params:
        target_arn = request_params["targetArn"]

    is_supported = (
        bool(event_name in KNOWN_ACTIONS) and
        bool(actor_arn) and
        ("errorCode" not in raw or raw["errorCode"] is None)
    )

    action = KNOWN_ACTIONS.get(event_name, f"unsupported:{event_name}")

    raw_evidence = {
        "eventID": event_id,
        "eventTime": event_time,
        "eventName": event_name,
        "eventSource": event_source,
        "userIdentity": user_identity,
        "requestParameters": request_params,
        "responseElements": response_elems,
        "sourceIPAddress": raw.get("sourceIPAddress"),
        "userAgent": raw.get("userAgent"),
        "errorCode": raw.get("errorCode"),
        "errorMessage": raw.get("errorMessage"),
    }

    return CanonicalEvent(
        event_id=str(event_id),
        event_time=str(event_time),
        action=action,
        service=str(event_source),
        actor_arn=str(actor_arn),
        target_arn=str(target_arn) if target_arn else None,
        is_supported=is_supported,
        raw_evidence=raw_evidence
    )


def normalize_events(raw_events: List[Dict[str, Any]]) -> List[CanonicalEvent]:
    """Normalizes a list of raw event dictionaries, sorting by eventTime."""
    canonical_list = [normalize_single_event(e) for e in raw_events]
    # Sort chronologically by event_time
    return sorted(canonical_list, key=lambda x: x.event_time)
