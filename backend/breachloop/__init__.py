"""BreachLoop - AI-Assisted Cloud Incident-Response Simulator."""

__version__ = "0.1.0"

from .models import (
    RawCloudTrailEvent,
    CanonicalEvent,
    UserIdentity,
    PrincipalNode,
    RoleNode,
    ResourceNode,
    WorkloadNode,
    BusinessWorkflow,
    AttackPath,
    AttackPathStep,
    IncidentHypothesis,
    RemediationCandidate,
    RemediationType,
    TwinState,
    SimulationResult,
    SimulationStatus,
    ReachabilityState,
    WorkflowVerification,
    EvidenceReport,
    BenchmarkSummary,
    BenchmarkResult,
)

from .ingestion import load_scenario, normalize_events
from .engine import (
    IncidentGraph,
    build_incident_graph,
    DeterministicAnalyst,
    DigitalTwin,
    create_baseline_twin_state,
)
from .storage import Database, init_database, get_database
from .benchmark import run_benchmark, BenchmarkRunner
from .cli import main, run_demo, run_benchmark_cmd

__all__ = [
    # Models
    "RawCloudTrailEvent",
    "CanonicalEvent",
    "UserIdentity",
    "PrincipalNode",
    "RoleNode",
    "ResourceNode",
    "WorkloadNode",
    "BusinessWorkflow",
    "AttackPath",
    "AttackPathStep",
    "IncidentHypothesis",
    "RemediationCandidate",
    "RemediationType",
    "TwinState",
    "SimulationResult",
    "SimulationStatus",
    "ReachabilityState",
    "WorkflowVerification",
    "EvidenceReport",
    "BenchmarkSummary",
    "BenchmarkResult",
    # Ingestion
    "load_scenario",
    "normalize_events",
    # Engine
    "IncidentGraph",
    "build_incident_graph",
    "DeterministicAnalyst",
    "DigitalTwin",
    "create_baseline_twin_state",
    # Storage
    "Database",
    "init_database",
    "get_database",
    # Benchmark
    "run_benchmark",
    "BenchmarkRunner",
    # CLI
    "main",
    "run_demo",
    "run_benchmark_cmd",
]