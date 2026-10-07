"""Digital Twin State Machine and Simulation Result Data Models."""

from enum import Enum
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from .topology import PrincipalNode, RoleNode, ResourceNode, WorkloadNode, BusinessWorkflow
from .events import CanonicalEvent


class SimulationStatus(str, Enum):
    VERIFIED = "verified"
    REJECTED = "rejected"
    UNVERIFIED = "unverified"


class ReachabilityState(BaseModel):
    attacker_entry_arn: str = Field(..., description="Attacker entrypoint ARN")
    target_resource_arn: str = Field(..., description="Target sensitive resource ARN")
    is_reachable: bool = Field(..., description="True if path exists from attacker to target")
    path_summary: Optional[str] = Field(None, description="Human readable path summary")


class WorkflowVerification(BaseModel):
    workflow_id: str = Field(..., description="Business workflow ID")
    workflow_name: str = Field(..., description="Workflow name")
    is_operational: bool = Field(..., description="True if workflow succeeds under twin state")
    failure_reason: Optional[str] = Field(None, description="Reason if workflow broke")


class TwinState(BaseModel):
    principals: Dict[str, PrincipalNode] = Field(default_factory=dict)
    roles: Dict[str, RoleNode] = Field(default_factory=dict)
    resources: Dict[str, ResourceNode] = Field(default_factory=dict)
    workloads: Dict[str, WorkloadNode] = Field(default_factory=dict)
    workflows: List[BusinessWorkflow] = Field(default_factory=list)
    active_policies: List[Dict[str, Any]] = Field(default_factory=list)
    observed_events: List[CanonicalEvent] = Field(
        default_factory=list,
        description="Observed canonical events that provide action edges in the twin graph"
    )


class SimulationResult(BaseModel):
    remediation_id: str = Field(..., description="ID of tested remediation candidate")
    remediation_title: str = Field(..., description="Title of candidate action")
    status: SimulationStatus = Field(..., description="verified, rejected, or unverified")
    reason: str = Field(..., description="Concise explanation of verification or rejection")
    before_reachability: ReachabilityState = Field(..., description="Pre-remediation reachability")
    after_reachability: ReachabilityState = Field(..., description="Post-remediation reachability")
    workflow_results: List[WorkflowVerification] = Field(default_factory=list, description="Health of business workflows")
    proof_details: Dict[str, Any] = Field(default_factory=dict, description="Before/after evidence comparison")
