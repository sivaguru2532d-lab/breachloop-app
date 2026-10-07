"""BreachLoop API Routes - All REST Endpoints."""

import uuid
from typing import Optional, List
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from breachloop.ingestion import load_scenario
from breachloop.ingestion.normalizer import normalize_events
from breachloop.engine import (
    build_incident_graph,
    DeterministicAnalyst,
    DigitalTwin,
    create_baseline_twin_state,
)
from breachloop.models import (
    EvidenceReport,
    SimulationResult,
    SimulationStatus,
    BenchmarkSummary,
    AttackPath,
)
from breachloop.storage import get_database


router = APIRouter()


# Request/Response Models
class HealthResponse(BaseModel):
    status: str = "healthy"
    service: str = "breachloop"
    version: str = "0.1.0"


class ScenarioSummary(BaseModel):
    scenario_id: str
    name: str
    description: str
    scenario_type: str
    event_count: int
    workflow_count: int
    candidate_count: int


class ScenarioDetail(BaseModel):
    scenario_id: str
    name: str
    description: str
    scenario_type: str
    events: List[dict]
    principals: List[dict]
    roles: List[dict]
    resources: List[dict]
    workloads: List[dict]
    workflows: List[dict]
    candidate_remediations: List[dict]


class RunIncidentRequest(BaseModel):
    scenario_id: str
    provider_mode: str = Field(default="deterministic", pattern="^(deterministic|anthropic)$")


class RunIncidentResponse(BaseModel):
    run_id: str
    scenario_id: str
    provider_mode: str
    status: str = "completed"


class SimulateRequest(BaseModel):
    remediation_id: str


class SimulateResponse(BaseModel):
    run_id: str
    remediation_id: str
    status: str
    reason: str
    before_reachability: dict
    after_reachability: dict
    workflow_results: List[dict]


# Endpoints
@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse()


@router.post("/benchmark/run", response_model=BenchmarkSummary)
async def run_benchmark_suite():
    """Run the synthetic benchmark suite against repository scenarios."""
    from breachloop.benchmark import run_benchmark
    from pathlib import Path

    scenarios_dir = Path(__file__).parents[3] / "scenarios"
    return run_benchmark(str(scenarios_dir))


@router.get("/scenarios", response_model=List[ScenarioSummary])
async def list_scenarios():
    """List all available scenarios with metadata."""
    db = get_database()
    scenarios = db.list_scenarios()
    return [
        ScenarioSummary(
            scenario_id=s["scenario_id"],
            name=s["name"],
            description=s["description"],
            scenario_type=s["scenario_type"],
            event_count=s["event_count"],
            workflow_count=s["workflow_count"],
            candidate_count=s["candidate_count"]
        )
        for s in scenarios
    ]


@router.get("/scenarios/{scenario_id}", response_model=ScenarioDetail)
async def get_scenario(scenario_id: str):
    """Get full scenario detail including events and topology."""
    try:
        scenario = load_scenario(scenario_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Scenario not found: {scenario_id}")

    return ScenarioDetail(
        scenario_id=scenario.id,
        name=scenario.name,
        description=scenario.description,
        scenario_type=scenario.scenario_type,
        events=scenario.raw_events,
        principals=[p.model_dump() for p in scenario.principals],
        roles=[r.model_dump() for r in scenario.roles],
        resources=[r.model_dump() for r in scenario.resources],
        workloads=[w.model_dump() for w in scenario.workloads],
        workflows=[w.model_dump() for w in scenario.workflows],
        candidate_remediations=[c.model_dump() for c in scenario.candidate_remediations]
    )


@router.post("/incidents/run", response_model=RunIncidentResponse)
async def run_incident(request: RunIncidentRequest):
    """Run a full incident simulation for a scenario."""
    try:
        scenario = load_scenario(request.scenario_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Scenario not found: {request.scenario_id}")

    # Normalize events
    canonical_events = normalize_events(scenario.raw_events)

    # Build graph
    graph = build_incident_graph(
        canonical_events,
        scenario.principals,
        scenario.roles,
        scenario.resources,
        scenario.workloads,
        scenario.workflows
    )

    attack_paths = graph.find_attack_paths()

    # Analyze
    analyst = DeterministicAnalyst()
    hypothesis = analyst.analyze(
        canonical_events,
        scenario.principals,
        scenario.roles,
        scenario.resources,
        scenario.workloads,
        scenario.workflows
    )

    # Create digital twin
    twin_state = create_baseline_twin_state(
        scenario.principals,
        scenario.roles,
        scenario.resources,
        scenario.workloads,
        scenario.workflows,
        canonical_events
    )
    twin = DigitalTwin(twin_state)

    # Test candidate remediations
    simulations = []
    for candidate in scenario.candidate_remediations:
        sim_result = twin.simulate(candidate)
        simulations.append(sim_result)

    # Build report
    primary_attack_path = attack_paths[0] if attack_paths else AttackPath(
        initial_compromise="none",
        target_resource="none",
        steps=[],
        evidence_event_ids=[]
    )

    report = EvidenceReport(
        run_id=str(uuid.uuid4())[:12],
        scenario_id=scenario.id,
        timestamp=__import__("datetime").datetime.utcnow().isoformat() + "Z",
        provider_mode=request.provider_mode,
        synthetic=True,
        events=canonical_events,
        attack_path=primary_attack_path,
        hypothesis=hypothesis,
        simulations=simulations
    )

    # Persist to database
    db = get_database()
    run_id = report.run_id
    db.save_incident_run(
        scenario_id=scenario.id,
        provider_mode=request.provider_mode,
        hypothesis_summary=hypothesis.summary,
        hypothesis_confidence=hypothesis.confidence,
        attack_path=primary_attack_path.model_dump(),
        full_report=report.model_dump()
    )
    for sim in simulations:
        db.save_simulation_result(run_id, sim.model_dump())

    return RunIncidentResponse(
        run_id=run_id,
        scenario_id=scenario.id,
        provider_mode=request.provider_mode
    )


@router.get("/incidents/{run_id}")
async def get_incident(run_id: str):
    """Get incident run details."""
    db = get_database()
    run = db.get_incident_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Incident run not found: {run_id}")

    # Include simulation results
    sims = db.get_simulation_results(run_id)
    run["simulations"] = sims

    return run


@router.post("/incidents/{run_id}/simulate", response_model=SimulateResponse)
async def simulate_remediation(run_id: str, request: SimulateRequest):
    """Simulate a specific remediation candidate for an existing run."""
    db = get_database()
    run = db.get_incident_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Incident run not found: {run_id}")

    # Load scenario
    scenario = load_scenario(run["scenario_id"])

    # Find candidate
    candidate_data = None
    for c in scenario.candidate_remediations:
        if c.id == request.remediation_id:
            candidate_data = c
            break

    if not candidate_data:
        raise HTTPException(
            status_code=404,
            detail=f"Remediation candidate not found: {request.remediation_id}"
        )

    # Recreate twin and simulate (with observed events for reachability)
    canonical_events = normalize_events(scenario.raw_events)
    twin_state = create_baseline_twin_state(
        scenario.principals,
        scenario.roles,
        scenario.resources,
        scenario.workloads,
        scenario.workflows,
        canonical_events
    )
    twin = DigitalTwin(twin_state)
    sim_result = twin.simulate(candidate_data)

    # Save result
    db.save_simulation_result(run_id, sim_result.model_dump())

    return SimulateResponse(
        run_id=run_id,
        remediation_id=sim_result.remediation_id,
        status=sim_result.status.value,
        reason=sim_result.reason,
        before_reachability=sim_result.before_reachability.model_dump(),
        after_reachability=sim_result.after_reachability.model_dump(),
        workflow_results=[w.model_dump() for w in sim_result.workflow_results]
    )


@router.get("/incidents/{run_id}/report", response_model=EvidenceReport)
async def get_report(run_id: str):
    """Get full evidence report for an incident run."""
    db = get_database()
    run = db.get_incident_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Incident run not found: {run_id}")

    # Parse stored full report
    full_report = run.get("full_report_json")
    if isinstance(full_report, str):
        import json
        full_report = json.loads(full_report)

    if full_report:
        return EvidenceReport(**full_report)

    # Fallback: reconstruct from stored data
    raise HTTPException(status_code=500, detail="Report data not available")