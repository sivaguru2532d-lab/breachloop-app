"""BreachLoop Benchmark Runner - Evaluates All Seeded Scenarios."""

import json
import time
from pathlib import Path
from typing import List, Dict, Any, Optional
from breachloop.ingestion import load_scenario
from breachloop.engine import (
    build_incident_graph,
    DeterministicAnalyst,
    DigitalTwin,
    create_baseline_twin_state,
)
from breachloop.models import (
    CanonicalEvent,
    PrincipalNode,
    RoleNode,
    ResourceNode,
    WorkloadNode,
    BusinessWorkflow,
    RemediationCandidate,
    AttackPath,
    IncidentHypothesis,
    SimulationResult,
    SimulationStatus,
    BenchmarkResult,
    BenchmarkSummary,
)
from breachloop.storage import get_database


class BenchmarkRunner:
    """Runs benchmark suite over all scenarios in the scenarios directory."""

    def __init__(self, scenarios_dir: Optional[str] = None):
        self.scenarios_dir = Path(scenarios_dir) if scenarios_dir else Path(__file__).parents[3] / "scenarios"
        self.db = get_database()
        self.analyst = DeterministicAnalyst()

    def run_all(self) -> BenchmarkSummary:
        """Execute benchmark on all scenario JSON files."""
        scenario_files = list(self.scenarios_dir.glob("*.json"))
        results: List[BenchmarkResult] = []

        for scenario_file in scenario_files:
            try:
                result = self._run_scenario(scenario_file)
                results.append(result)
            except Exception as e:
                # Record failure
                results.append(BenchmarkResult(
                    scenario_id=scenario_file.stem,
                    scenario_name=scenario_file.stem,
                    scenario_type="unknown",
                    broad_fix_status="error",
                    narrow_fix_status="error",
                    workflow_preservation_pass=False,
                    passed=False,
                    execution_time_ms=0.0
                ))

        # Calculate summary
        total = len(results)
        passed = sum(1 for r in results if r.passed)
        failed = total - passed
        attack_count = sum(1 for r in results if r.scenario_type == "attack")
        benign_count = sum(1 for r in results if r.scenario_type == "benign")

        summary = BenchmarkSummary(
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            total_scenarios=total,
            attack_scenarios_count=attack_count,
            benign_scenarios_count=benign_count,
            passed_scenarios=passed,
            failed_scenarios=failed,
            accuracy_percentage=(passed / total * 100.0) if total > 0 else 0.0,
            results=results
        )

        return summary

    def _run_scenario(self, scenario_file: Path) -> BenchmarkResult:
        """Run benchmark on a single scenario file."""
        start_time = time.time()

        # Load scenario with ground truth
        scenario = load_scenario(scenario_file.stem, str(self.scenarios_dir))
        ground_truth = scenario.ground_truth

        # Normalize events
        canonical_events = []
        for raw_event in scenario.raw_events:
            from breachloop.ingestion import normalize_single_event
            canonical_events.append(normalize_single_event(raw_event))

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
        hypothesis = self.analyst.analyze(
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
        broad_result = None
        narrow_result = None

        for candidate in scenario.candidate_remediations:
            sim_result = twin.simulate(candidate)
            if candidate.is_broad:
                broad_result = sim_result
            else:
                narrow_result = sim_result

        # Evaluate against ground truth (only for attack scenarios)
        execution_time = (time.time() - start_time) * 1000

        if scenario.scenario_type == "benign":
            # Benign scenario: should have no attack paths
            passed = len(attack_paths) == 0
            return BenchmarkResult(
                scenario_id=scenario.id,
                scenario_name=scenario.name,
                scenario_type="benign",
                broad_fix_status="n/a",
                narrow_fix_status="n/a",
                workflow_preservation_pass=passed,
                passed=passed,
                execution_time_ms=execution_time
            )

        # Attack scenario: check broad and narrow fix outcomes
        expected_broad = ground_truth.get("expected_broad_remediation_status", "rejected")
        expected_narrow = ground_truth.get("expected_narrow_remediation_status", "verified")
        expected_broken = ground_truth.get("expected_broad_remediation_broken_workflow", "")

        broad_passed = False
        narrow_passed = False
        workflow_pass = False

        if broad_result:
            broad_passed = (broad_result.status.value == expected_broad)
            if expected_broken and broad_result.status == SimulationStatus.REJECTED:
                # Check if the right workflow was broken
                broken_workflows = [w for w in broad_result.workflow_results if not w.is_operational]
                if any(b.workflow_id == expected_broken for b in broken_workflows):
                    workflow_pass = True

        if narrow_result:
            narrow_passed = (narrow_result.status.value == expected_narrow)
            if narrow_result.status == SimulationStatus.VERIFIED:
                # Check all workflows operational
                workflow_pass = workflow_pass or all(w.is_operational for w in narrow_result.workflow_results)

        overall_passed = broad_passed and narrow_passed and workflow_pass

        return BenchmarkResult(
            scenario_id=scenario.id,
            scenario_name=scenario.name,
            scenario_type="attack",
            broad_fix_status=f"expected:{expected_broad},actual:{broad_result.status.value if broad_result else 'none'}",
            narrow_fix_status=f"expected:{expected_narrow},actual:{narrow_result.status.value if narrow_result else 'none'}",
            workflow_preservation_pass=workflow_pass,
            passed=overall_passed,
            execution_time_ms=execution_time
        )


def run_benchmark(scenarios_dir: Optional[str] = None, output_path: Optional[str] = None) -> BenchmarkSummary:
    """Convenience function to run full benchmark and optionally save to file."""
    runner = BenchmarkRunner(scenarios_dir)
    summary = runner.run_all()

    if output_path:
        output_dir = Path(output_path).parent
        output_dir.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(summary.model_dump(), f, indent=2, default=str)

    return summary