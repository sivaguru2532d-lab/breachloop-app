"""Evidence Report Contract and Synthetic Benchmark Data Models."""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from .events import CanonicalEvent
from .incident import AttackPath, IncidentHypothesis
from .twin import SimulationResult


class EvidenceReport(BaseModel):
    run_id: str = Field(..., description="Unique simulation run identifier")
    scenario_id: str = Field(..., description="Target scenario identifier")
    timestamp: str = Field(..., description="Execution ISO timestamp")
    provider_mode: str = Field("deterministic", description="deterministic or anthropic")
    synthetic: bool = Field(True, description="Explicit synthetic indicator marker")

    events: List[CanonicalEvent] = Field(default_factory=list, description="Ordered canonical events")
    attack_path: AttackPath = Field(..., description="Derived attack path")
    hypothesis: IncidentHypothesis = Field(..., description="Incident threat hypothesis")
    simulations: List[SimulationResult] = Field(default_factory=list, description="Tested candidate remediations")

    benchmark_outcome: Optional[Dict[str, Any]] = Field(None, description="Benchmark evaluation score")
    warnings: List[str] = Field(
        default_factory=lambda: [
            "SYNTHETIC SIMULATOR RESULTS ONLY: This report was produced by an in-process digital twin.",
            "Never use as production cloud authorization or real-world efficacy proof."
        ],
        description="Mandatory synthetic safety disclaimers"
    )


class BenchmarkResult(BaseModel):
    scenario_id: str = Field(..., description="Scenario ID")
    scenario_name: str = Field(..., description="Human readable scenario title")
    scenario_type: str = Field("attack", description="attack or benign")
    broad_fix_status: str = Field(..., description="Expected vs actual status for broad fix")
    narrow_fix_status: str = Field(..., description="Expected vs actual status for narrow fix")
    workflow_preservation_pass: bool = Field(..., description="True if benign workflow health matched ground truth")
    passed: bool = Field(..., description="True if scenario benchmark expectations were met")
    execution_time_ms: float = Field(..., description="Execution wall-clock latency")


class BenchmarkSummary(BaseModel):
    timestamp: str = Field(..., description="ISO timestamp")
    total_scenarios: int = Field(..., description="Total evaluated scenarios")
    attack_scenarios_count: int = Field(..., description="Number of attack scenarios")
    benign_scenarios_count: int = Field(..., description="Number of benign scenarios")
    passed_scenarios: int = Field(..., description="Number of passed benchmark scenarios")
    failed_scenarios: int = Field(..., description="Number of failed benchmark scenarios")
    accuracy_percentage: float = Field(..., description="Overall benchmark accuracy percentage")
    results: List[BenchmarkResult] = Field(default_factory=list, description="Detailed per-scenario metrics")
    synthetic: bool = Field(True, description="Synthetic benchmark marker")
    disclaimer: str = Field(
        "SYNTHETIC BENCHMARK RESULTS ONLY: Metrics evaluated against in-process digital twin pack.",
        description="Disclaimer warning"
    )
