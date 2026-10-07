"""BreachLoop CLI - Demo and Benchmark Commands."""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

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
)
from breachloop.storage import get_database


def run_demo(
    scenario_id: str,
    output_path: Optional[str] = None,
    provider: str = "deterministic"
) -> EvidenceReport:
    """Run incident simulation for a single scenario."""
    # Load scenario
    scenario = load_scenario(scenario_id)

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
    primary_attack_path = attack_paths[0] if attack_paths else None

    # Handle case where there are no attack paths (benign scenarios)
    if not attack_paths:
        from breachloop.models import AttackPath, AttackPathStep
        primary_attack_path = AttackPath(
            initial_compromise="none",
            target_resource="none",
            steps=[],
            evidence_event_ids=[]
        )

    report = EvidenceReport(
        run_id="demo-" + scenario_id,
        scenario_id=scenario.id,
        timestamp=__import__("datetime").datetime.utcnow().isoformat() + "Z",
        provider_mode=provider,
        synthetic=True,
        events=canonical_events,
        attack_path=primary_attack_path,
        hypothesis=hypothesis,
        simulations=simulations
    )

    # Save to file if output path provided
    if output_path:
        output_dir = Path(output_path).parent
        output_dir.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report.model_dump(), f, indent=2, default=str)

    # Persist to database
    db = get_database()
    db.save_incident_run(
        scenario_id=scenario.id,
        provider_mode=provider,
        hypothesis_summary=hypothesis.summary,
        hypothesis_confidence=hypothesis.confidence,
        attack_path=primary_attack_path.model_dump() if primary_attack_path else {},
        full_report=report.model_dump()
    )
    run_id = "demo-" + scenario.id
    for sim in simulations:
        db.save_simulation_result(run_id, sim.model_dump())

    return report


def run_benchmark_cmd(
    output_path: Optional[str] = None,
    scenarios_dir: str = "scenarios"
):
    """Run full benchmark suite."""
    from breachloop.benchmark import run_benchmark
    summary = run_benchmark(scenarios_dir, output_path)
    return summary


def main():
    parser = argparse.ArgumentParser(
        prog="breachloop",
        description="BreachLoop - AI-Assisted Cloud Incident-Response Simulator"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Demo command
    demo_parser = subparsers.add_parser("demo", help="Run single incident demo")
    demo_parser.add_argument(
        "--scenario",
        default="compromised-role",
        help="Scenario ID to run (default: compromised-role)"
    )
    demo_parser.add_argument(
        "--out",
        help="Output JSON report path (e.g., reports/compromised-role.json)"
    )
    demo_parser.add_argument(
        "--provider",
        choices=["deterministic", "anthropic"],
        default="deterministic",
        help="AI provider mode (default: deterministic)"
    )

    # Benchmark command
    bench_parser = subparsers.add_parser("benchmark", help="Run full benchmark suite")
    bench_parser.add_argument(
        "--out",
        help="Output JSON benchmark path (e.g., reports/benchmark.json)"
    )
    bench_parser.add_argument(
        "--scenarios-dir",
        help="Directory containing scenario JSON files"
    )

    # Serve command
    serve_parser = subparsers.add_parser("serve", help="Start FastAPI backend server")
    serve_parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind (default: 127.0.0.1)"
    )
    serve_parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to bind (default: 8000)"
    )

    args = parser.parse_args()

    try:
        if args.command == "demo":
            report = run_demo(args.scenario, args.out, args.provider)
            print(json.dumps(report.model_dump(), indent=2, default=str))
            if args.out:
                print(f"\nReport saved to: {args.out}", file=sys.stderr)

        elif args.command == "benchmark":
            summary = run_benchmark_cmd(args.out, args.scenarios_dir)
            print(json.dumps(summary.model_dump(), indent=2, default=str))
            if args.out:
                print(f"\nBenchmark saved to: {args.out}", file=sys.stderr)
            print(f"\nAccuracy: {summary.accuracy_percentage:.1f}% ({summary.passed_scenarios}/{summary.total_scenarios})", file=sys.stderr)

        elif args.command == "serve":
            import uvicorn
            uvicorn.run("breachloop.api.app:create_app", host=args.host, port=args.port, reload=True)

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        if __import__("os").environ.get("BREACHLOOP_DEBUG"):
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()