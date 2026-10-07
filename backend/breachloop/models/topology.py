"""Cloud Topology and Business Workflow Data Models."""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class PrincipalNode(BaseModel):
    id: str = Field(..., description="Node unique ID / ARN")
    name: str = Field(..., description="Human-readable name")
    type: str = Field("Principal", description="Node type discriminator")
    arn: str = Field(..., description="Full ARN")
    is_compromised: bool = Field(False, description="Initial compromise flag")


class RoleNode(BaseModel):
    id: str = Field(..., description="Node unique ID / ARN")
    name: str = Field(..., description="Role name")
    type: str = Field("Role", description="Node type discriminator")
    arn: str = Field(..., description="Role ARN")
    trust_policy: Dict[str, Any] = Field(default_factory=dict, description="IAM Trust Relationship")
    attached_policies: List[Dict[str, Any]] = Field(default_factory=list, description="Inline or Managed Policies")


class ResourceNode(BaseModel):
    id: str = Field(..., description="Node unique ID / ARN")
    name: str = Field(..., description="Resource name")
    type: str = Field("Resource", description="Node type discriminator, e.g. S3Bucket, SecretsManager")
    arn: str = Field(..., description="Resource ARN")
    is_sensitive: bool = Field(False, description="Target sensitive data indicator")
    resource_policy: Optional[Dict[str, Any]] = Field(None, description="Resource policy, e.g. S3 Bucket Policy")


class WorkloadNode(BaseModel):
    id: str = Field(..., description="Node unique ID")
    name: str = Field(..., description="Workload name")
    type: str = Field("Workload", description="Compute type: EC2, Lambda, ECS")
    arn: str = Field(..., description="Workload ARN")
    execution_role_arn: str = Field(..., description="Assumed execution role ARN")


class BusinessWorkflow(BaseModel):
    id: str = Field(..., description="Workflow ID, e.g. billing-export")
    name: str = Field(..., description="Human-readable workflow name")
    description: str = Field(..., description="Purpose of business workflow")
    principal_arn: str = Field(..., description="Role or Principal executing this workflow")
    required_action: str = Field(..., description="Action required, e.g. s3:GetObject")
    target_resource_arn: str = Field(..., description="Required resource ARN, e.g. arn:aws:s3:::billing-ledger")
    criticality: str = Field("High", description="Business criticality: High, Medium, Low")
