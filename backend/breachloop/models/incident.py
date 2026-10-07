"""Incident Hypothesis, Attack Path, and Remediation Candidate Models."""

from enum import Enum
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class RemediationType(str, Enum):
    REVOKE_ROLE_SESSIONS = "revoke_role_sessions"
    REMOVE_RESOURCE_PERMISSION = "remove_resource_permission"
    ISOLATE_WORKLOAD = "isolate_workload"
    ATTACH_INLINE_DENY = "attach_inline_deny"


class AttackPathStep(BaseModel):
    step_number: int = Field(..., description="Step sequence index")
    source_node: str = Field(..., description="Source principal or role ARN")
    action: str = Field(..., description="API action performed, e.g. sts:AssumeRole")
    target_node: str = Field(..., description="Target role or resource ARN")
    evidence_event_id: str = Field(..., description="Preserved event ID backing this step")


class AttackPath(BaseModel):
    initial_compromise: str = Field(..., description="Entrypoint identity ARN")
    target_resource: str = Field(..., description="Exfiltrated or compromised resource ARN")
    steps: List[AttackPathStep] = Field(default_factory=list, description="Ordered steps")
    evidence_event_ids: List[str] = Field(default_factory=list, description="All event IDs in path")


class IncidentHypothesis(BaseModel):
    summary: str = Field(..., description="Executive threat summary")
    attack_vector: str = Field(..., description="Initial compromise vector")
    impacted_identities: List[str] = Field(..., description="Compromised role/user ARNs")
    impacted_resources: List[str] = Field(..., description="Target sensitive resource ARNs")
    confidence: float = Field(..., description="Confidence score from 0.0 to 1.0")
    evidence_event_ids: List[str] = Field(..., description="Preserved source event IDs")
    unknowns: List[str] = Field(default_factory=list, description="Ambiguous fields or missing data")


class RemediationCandidate(BaseModel):
    id: str = Field(..., description="Candidate ID, e.g. fix-broad-01 or fix-narrow-01")
    title: str = Field(..., description="Short remediation title")
    remediation_type: RemediationType = Field(..., description="Typed action category")
    target_arn: str = Field(..., description="Target role, resource, or workload ARN")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Action parameters, e.g. denied_action, denied_resource")
    description: str = Field(..., description="Detailed description of proposed fix")
    is_broad: bool = Field(False, description="Flag for broad role-level vs narrow resource-scoped fix")
