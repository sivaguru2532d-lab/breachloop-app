"""Scenario Loader with Out-of-Band Benchmark Ground-Truth Separation."""

import json
from pathlib import Path
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from breachloop.models import (
    RawCloudTrailEvent,
    PrincipalNode,
    RoleNode,
    ResourceNode,
    WorkloadNode,
    BusinessWorkflow,
    RemediationCandidate
)


class ScenarioData(BaseModel):
    id: str = Field(..., description="Scenario ID, e.g. compromised-role")
    name: str = Field(..., description="Scenario name")
    description: str = Field(..., description="Scenario story description")
    scenario_type: str = Field("attack", description="attack or benign")

    # Detector / Analysis Inputs
    raw_events: List[Dict[str, Any]] = Field(default_factory=list)
    principals: List[PrincipalNode] = Field(default_factory=list)
    roles: List[RoleNode] = Field(default_factory=list)
    resources: List[ResourceNode] = Field(default_factory=list)
    workloads: List[WorkloadNode] = Field(default_factory=list)
    workflows: List[BusinessWorkflow] = Field(default_factory=list)
    candidate_remediations: List[RemediationCandidate] = Field(default_factory=list)

    # Strictly Isolated Ground-Truth Benchmark Labels (NOT passed to detector/analyst)
    ground_truth: Dict[str, Any] = Field(
        default_factory=dict,
        description="Out-of-band ground-truth benchmark labels for evaluation only"
    )


def load_scenario(scenario_id_or_path: str, scenarios_dir: Optional[str] = None) -> ScenarioData:
    """Loads a scenario JSON file from disk by ID or direct path.

    Validates structure and enforces separation of detector inputs vs ground-truth labels.
    """
    target_path = Path(scenario_id_or_path)
    if not target_path.exists():
        search_dirs = [
            Path(scenarios_dir) if scenarios_dir else None,
            Path(__file__).parents[3] / "scenarios",
            Path.cwd() / "scenarios",
        ]
        found = False
        for d in search_dirs:
            if d and d.exists():
                candidate = d / f"{scenario_id_or_path}.json"
                if candidate.exists():
                    target_path = candidate
                    found = True
                    break
                candidate_underscore = d / f"{scenario_id_or_path.replace('-', '_')}.json"
                if candidate_underscore.exists():
                    target_path = candidate_underscore
                    found = True
                    break
        if not found:
            raise FileNotFoundError(f"Scenario file not found for ID: {scenario_id_or_path}")

    with open(target_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Extract detector inputs
    raw_events = data.get("events", [])
    principals = [PrincipalNode(**p) for p in data.get("principals", [])]
    roles = [RoleNode(**r) for r in data.get("roles", [])]
    resources = [ResourceNode(**res) for res in data.get("resources", [])]
    workloads = [WorkloadNode(**w) for w in data.get("workloads", [])]
    workflows = [BusinessWorkflow(**wf) for wf in data.get("workflows", [])]
    candidates = [RemediationCandidate(**c) for c in data.get("candidate_remediations", [])]

    # Ground truth is isolated under 'ground_truth' key
    ground_truth = data.get("ground_truth", {})

    return ScenarioData(
        id=data.get("id", target_path.stem),
        name=data.get("name", target_path.stem),
        description=data.get("description", ""),
        scenario_type=data.get("scenario_type", "attack"),
        raw_events=raw_events,
        principals=principals,
        roles=roles,
        resources=resources,
        workloads=workloads,
        workflows=workflows,
        candidate_remediations=candidates,
        ground_truth=ground_truth
    )
