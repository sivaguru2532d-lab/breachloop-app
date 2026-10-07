"""SQLite Repository for Incident Runs, Reports, and Scenario Metadata."""

import sqlite3
import json
import uuid
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime
from contextlib import contextmanager


DB_PATH = "breachloop.sqlite"


def init_database(db_path: str = DB_PATH) -> sqlite3.Connection:
    """Initialize database schema."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Incident runs table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS incident_runs (
            run_id TEXT PRIMARY KEY,
            scenario_id TEXT NOT NULL,
            provider_mode TEXT NOT NULL DEFAULT 'deterministic',
            timestamp TEXT NOT NULL,
            synthetic INTEGER NOT NULL DEFAULT 1,
            hypothesis_summary TEXT,
            hypothesis_confidence REAL,
            attack_path_json TEXT,
            full_report_json TEXT
        )
    """)

    # Simulation results table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS simulation_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            remediation_id TEXT NOT NULL,
            remediation_title TEXT,
            status TEXT NOT NULL,
            reason TEXT,
            before_reachability_json TEXT,
            after_reachability_json TEXT,
            workflow_results_json TEXT,
            proof_details_json TEXT,
            FOREIGN KEY (run_id) REFERENCES incident_runs (run_id)
        )
    """)

    # Scenarios table (metadata for listing)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scenarios (
            scenario_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            scenario_type TEXT NOT NULL,
            event_count INTEGER DEFAULT 0,
            workflow_count INTEGER DEFAULT 0,
            candidate_count INTEGER DEFAULT 0,
            ground_truth_json TEXT
        )
    """)

    conn.commit()
    return conn


@contextmanager
def get_connection(db_path: str = DB_PATH):
    """Context manager for database connections."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


class Database:
    """SQLite repository for BreachLoop data."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        init_database(db_path)

    def save_incident_run(
        self,
        scenario_id: str,
        provider_mode: str,
        hypothesis_summary: str,
        hypothesis_confidence: float,
        attack_path: Dict[str, Any],
        full_report: Dict[str, Any]
    ) -> str:
        """Persist a complete incident run with report."""
        run_id = full_report.get("run_id") or str(uuid.uuid4())[:12]
        timestamp = full_report.get("timestamp") or datetime.utcnow().isoformat() + "Z"

        with get_connection(self.db_path) as conn:
            conn.execute("""
                INSERT INTO incident_runs
                (run_id, scenario_id, provider_mode, timestamp, synthetic, hypothesis_summary, hypothesis_confidence, attack_path_json, full_report_json)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
            """, (
                run_id,
                scenario_id,
                provider_mode,
                timestamp,
                hypothesis_summary,
                hypothesis_confidence,
                json.dumps(attack_path),
                json.dumps(full_report)
            ))

        return run_id

    def get_incident_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve incident run by ID."""
        with get_connection(self.db_path) as conn:
            row = conn.execute("SELECT * FROM incident_runs WHERE run_id = ?", (run_id,)).fetchone()
            if row:
                return dict(row)
        return None

    def save_simulation_result(
        self,
        run_id: str,
        result: Dict[str, Any]
    ):
        """Persist a single remediation simulation result."""
        with get_connection(self.db_path) as conn:
            conn.execute("""
                INSERT INTO simulation_results
                (run_id, remediation_id, remediation_title, status, reason,
                 before_reachability_json, after_reachability_json, workflow_results_json, proof_details_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                run_id,
                result.get("remediation_id"),
                result.get("remediation_title"),
                result.get("status"),
                result.get("reason"),
                json.dumps(result.get("before_reachability")),
                json.dumps(result.get("after_reachability")),
                json.dumps(result.get("workflow_results")),
                json.dumps(result.get("proof_details"))
            ))

    def get_simulation_results(self, run_id: str) -> List[Dict[str, Any]]:
        """Retrieve all simulation results for a run."""
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM simulation_results WHERE run_id = ?", (run_id,)
            ).fetchall()
            return [dict(r) for r in rows]

    def upsert_scenario_metadata(self, scenario_data: Dict[str, Any]):
        """Idempotently insert or update scenario metadata."""
        scenario_id = scenario_data.get("id", "")
        ground_truth = scenario_data.get("ground_truth", {})

        with get_connection(self.db_path) as conn:
            conn.execute("""
                INSERT INTO scenarios
                (scenario_id, name, description, scenario_type, event_count, workflow_count, candidate_count, ground_truth_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(scenario_id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    scenario_type = excluded.scenario_type,
                    event_count = excluded.event_count,
                    workflow_count = excluded.workflow_count,
                    candidate_count = excluded.candidate_count,
                    ground_truth_json = excluded.ground_truth_json
            """, (
                scenario_id,
                scenario_data.get("name", scenario_id),
                scenario_data.get("description", ""),
                scenario_data.get("scenario_type", "attack"),
                len(scenario_data.get("events", [])),
                len(scenario_data.get("workflows", [])),
                len(scenario_data.get("candidate_remediations", [])),
                json.dumps(ground_truth)
            ))

    def seed_scenario_directory(self, scenarios_dir: Optional[str] = None) -> List[str]:
        """Scan the repo for scenario JSON files and insert/update their metadata."""
        search_dirs = [
            Path(scenarios_dir) if scenarios_dir else None,
            Path(__file__).parents[3] / "scenarios",
            Path.cwd() / "scenarios",
        ]

        discovered: List[str] = []
        for directory in search_dirs:
            if not directory or not directory.exists():
                continue
            for scenario_file in sorted(directory.glob("*.json")):
                try:
                    with open(scenario_file, "r", encoding="utf-8") as handle:
                        scenario_data = json.load(handle)
                except (json.JSONDecodeError, OSError):
                    continue

                self.upsert_scenario_metadata(scenario_data)
                discovered.append(scenario_file.stem)

        return discovered

    def list_scenarios(self) -> List[Dict[str, Any]]:
        """List all seeded scenarios."""
        with get_connection(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM scenarios ORDER BY scenario_type, scenario_id").fetchall()
            if rows:
                return [dict(r) for r in rows]

        # Fallback: seed from disk if database is empty.
        self.seed_scenario_directory()
        with get_connection(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM scenarios ORDER BY scenario_type, scenario_id").fetchall()
            return [dict(r) for r in rows]

    def get_scenario_metadata(self, scenario_id: str) -> Optional[Dict[str, Any]]:
        """Get scenario metadata by ID."""
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM scenarios WHERE scenario_id = ?", (scenario_id,)
            ).fetchone()
            if row:
                return dict(row)
        return None


# Module-level convenience functions
_database_instance: Optional[Database] = None


def get_database() -> Database:
    """Get singleton database instance."""
    global _database_instance
    if _database_instance is None:
        _database_instance = Database()
    _database_instance.seed_scenario_directory()
    return _database_instance