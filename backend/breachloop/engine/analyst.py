"""Deterministic Heuristic Analyst Engine."""

from typing import List, Dict, Any
from breachloop.models import (
    CanonicalEvent,
    AttackPath,
    IncidentHypothesis,
    PrincipalNode,
    RoleNode,
    ResourceNode,
    WorkloadNode,
    BusinessWorkflow,
)
from .graph import IncidentGraph, build_incident_graph


class DeterministicAnalyst:
    """Deterministic rule-based incident analyst.

    Produces a structured IncidentHypothesis with confidence scoring based on
    graph reachability and event evidence. No external LLM calls.
    """

    def __init__(self):
        self.confidence_thresholds = {
            "high": 0.85,
            "medium": 0.60,
            "low": 0.35,
        }

    def analyze(
        self,
        events: List[CanonicalEvent],
        principals: List[PrincipalNode],
        roles: List[RoleNode],
        resources: List[ResourceNode],
        workloads: List[WorkloadNode],
        workflows: List[BusinessWorkflow],
    ) -> IncidentHypothesis:
        """Generate deterministic incident hypothesis from evidence."""
        graph = build_incident_graph(events, principals, roles, resources, workloads, workflows)
        attack_paths = graph.find_attack_paths()

        if not attack_paths:
            return IncidentHypothesis(
                summary="No attack path detected from compromised identities to sensitive resources.",
                attack_vector="None detected",
                impacted_identities=[],
                impacted_resources=[],
                confidence=0.1,
                evidence_event_ids=[],
                unknowns=["No sensitive resource reachability from known compromised entries"]
            )

        # Use the shortest/most direct path as primary
        primary_path = min(attack_paths, key=lambda p: len(p.steps))
        entry_arn = primary_path.initial_compromise
        target_arn = primary_path.target_resource

        # Find compromised identities
        compromised = [p.arn for p in principals if p.is_compromised]
        # Also include assumed-role sessions that originated from compromised
        for event in events:
            if event.actor_arn in compromised and event.target_arn:
                compromised.append(event.target_arn)

        # Find sensitive resources reached
        reached_resources = set()
        for path in attack_paths:
            reached_resources.add(path.target_resource)

        # Compute confidence based on path evidence strength
        confidence = self._compute_confidence(primary_path, events)

        # Collect all unique evidence event IDs
        all_evidence = set()
        for path in attack_paths:
            all_evidence.update(path.evidence_event_ids)

        # Determine unknowns
        unknowns = self._determine_unknowns(events, graph, primary_path)

        # Build summary
        summary = self._build_summary(primary_path, entry_arn, target_arn)

        return IncidentHypothesis(
            summary=summary,
            attack_vector=self._classify_vector(primary_path),
            impacted_identities=list(set(compromised)),
            impacted_resources=list(reached_resources),
            confidence=confidence,
            evidence_event_ids=sorted(list(all_evidence)),
            unknowns=unknowns
        )

    def _compute_confidence(self, path: AttackPath, events: List[CanonicalEvent]) -> float:
        """Compute confidence score based on path evidence quality."""
        if not path.steps:
            return 0.1

        base_confidence = 0.7

        # Boost for direct observed actions (not topology-inferred)
        observed_steps = sum(1 for s in path.steps if s.evidence_event_id != "topology")
        if observed_steps > 0:
            base_confidence += min(0.2, observed_steps * 0.05)

        # Boost for privilege escalation (AssumeRole in path)
        has_assume_role = any("AssumeRole" in s.action for s in path.steps)
        if has_assume_role:
            base_confidence += 0.1

        # Penalize for unsupported events in path
        unsupported_in_path = False
        for event in events:
            if event.event_id in path.evidence_event_ids and not event.is_supported:
                unsupported_in_path = True
                break
        if unsupported_in_path:
            base_confidence -= 0.15

        return max(0.0, min(1.0, base_confidence))

    def _classify_vector(self, path: AttackPath) -> str:
        """Classify initial attack vector from first step."""
        if not path.steps:
            return "Unknown"

        first_step = path.steps[0]
        if "AssumeRole" in first_step.action:
            return f"Compromised identity assumes role ({first_step.target_node})"
        elif "GetSecretValue" in first_step.action:
            return "Secrets exfiltration via metadata or credentials"
        elif "ModifyDBSnapshotAttribute" in first_step.action:
            return "Database snapshot public sharing"
        elif "PutBucketPolicy" in first_step.action:
            return "S3 bucket policy modification"
        elif "CreateAccessKey" in first_step.action:
            return "IAM privilege escalation via access key creation"
        elif "ScheduleKeyDeletion" in first_step.action:
            return "KMS key deletion / ransomware"
        else:
            return f"Initial action: {first_step.action}"

    def _build_summary(self, path: AttackPath, entry: str, target: str) -> str:
        """Build executive summary string."""
        steps_desc = " -> ".join([f"{s.action}({s.target_node.split('/')[-1]})" for s in path.steps[:3]])
        return (
            f"Attacker from {entry.split('/')[-1]} traversed: {steps_desc} "
            f"to access sensitive target {target.split('/')[-1]}. "
            f"Path contains {len(path.steps)} steps with {len(path.evidence_event_ids)} corroborating events."
        )

    def _determine_unknowns(
        self,
        events: List[CanonicalEvent],
        graph: IncidentGraph,
        path: AttackPath
    ) -> List[str]:
        """Identify ambiguous or missing evidence."""
        unknowns = []

        unsupported_count = sum(1 for e in events if not e.is_supported)
        if unsupported_count > 0:
            unknowns.append(f"{unsupported_count} unsupported event types excluded from path analysis")

        if not path.steps:
            unknowns.append("No attack path steps reconstructed")

        # Check for missing topology evidence
        topology_edges = sum(1 for s in path.steps if s.evidence_event_id == "topology")
        if topology_edges > 0:
            unknowns.append(f"{topology_edges} path steps inferred from topology (not directly observed)")

        # Check for missing resource policies
        for event in events:
            if event.target_arn and event.target_arn not in [n for n in graph.nodes]:
                unknowns.append(f"Target resource {event.target_arn} not found in topology model")

        return unknowns