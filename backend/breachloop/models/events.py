"""CloudTrail and Canonical Event Data Models."""

from typing import Dict, Any, Optional
from pydantic import BaseModel, Field


class UserIdentity(BaseModel):
    type: str = Field(..., description="Identity type, e.g. IAMUser, AssumedRole, Root")
    principalId: str = Field(..., description="Unique principal identifier")
    arn: str = Field(..., description="Full ARN of identity")
    accountId: Optional[str] = Field(None, description="AWS Account ID")
    userName: Optional[str] = Field(None, description="User name if applicable")
    sessionContext: Optional[Dict[str, Any]] = Field(default_factory=dict)


class RawCloudTrailEvent(BaseModel):
    eventID: str = Field(..., description="Unique CloudTrail Event ID UUID")
    eventTime: str = Field(..., description="ISO-8601 Timestamp")
    eventName: str = Field(..., description="API action name, e.g. AssumeRole, GetObject")
    eventSource: str = Field(..., description="Service name, e.g. sts.amazonaws.com")
    userIdentity: UserIdentity
    requestParameters: Optional[Dict[str, Any]] = Field(default_factory=dict)
    responseElements: Optional[Dict[str, Any]] = Field(default_factory=dict)
    sourceIPAddress: Optional[str] = Field(None)
    userAgent: Optional[str] = Field(None)
    errorCode: Optional[str] = Field(None)
    errorMessage: Optional[str] = Field(None)


class CanonicalEvent(BaseModel):
    event_id: str = Field(..., description="Preserved source eventID")
    event_time: str = Field(..., description="Timestamp")
    action: str = Field(..., description="Normalized API action, e.g. sts:AssumeRole")
    service: str = Field(..., description="Service namespace")
    actor_arn: str = Field(..., description="Identity ARN performing the action")
    target_arn: Optional[str] = Field(None, description="Target resource or role ARN")
    is_supported: bool = Field(True, description="False if event action or schema is unsupported")
    raw_evidence: Dict[str, Any] = Field(default_factory=dict, description="Preserved evidence fields")
