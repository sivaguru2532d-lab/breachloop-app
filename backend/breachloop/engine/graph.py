"""Deterministic Incident Graph Builder and Attack Path Tracer."""

from typing import List, Dict, Set, Optional, Tuple
from breachloop.models import (
    CanonicalEvent,
    PrincipalNode,
    RoleNode,
    ResourceNode,
    WorkloadNode,
    BusinessWorkflow,
    AttackPath,
    AttackPathStep,
)


class IncidentGraph:
    """Directed graph representation of identities, roles, resources, and observed actions."""

    def __init__(self):
        self.nodes: Dict[str, Dict] = {}  # ARN -> {type, metadata}
        self.edges: List[Tuple[str, str, str, str]] = []  # (src, dst, action, evidence_event_id)
        self.attacker_entries: Set[str] = set()
        self.sensitive_targets: Set[str] = set()

    def add_principal(self, principal: PrincipalNode):
        self.nodes[principal.arn] = {"type": "principal", "node": principal}
        if principal.is_compromised:
            self.attacker_entries.add(principal.arn)

    def add_role(self, role: RoleNode):
        self.nodes[role.arn] = {"type": "role", "node": role}

    def add_resource(self, resource: ResourceNode):
        self.nodes[resource.arn] = {"type": "resource", "node": resource}
        if resource.is_sensitive:
            self.sensitive_targets.add(resource.arn)

    def add_workload(self, workload: WorkloadNode):
        self.nodes[workload.arn] = {"type": "workload", "node": workload}
        # Link workload to its execution role
        self.edges.append((workload.arn, workload.execution_role_arn, "executes_as", "topology"))

    def add_observed_action(self, event: CanonicalEvent):
        """Add observed action edge from actor to target with event ID evidence."""
        if event.target_arn and event.is_supported:
            self.edges.append((event.actor_arn, event.target_arn, event.action, event.event_id))

    def add_can_assume(self, principal_arn: str, role_arn: str, event_id: str = "topology"):
        """Add CanAssume edge."""
        self.edges.append((principal_arn, role_arn, "sts:AssumeRole", event_id))

    def add_permission(self, principal_arn: str, resource_arn: str, action: str, event_id: str = "topology"):
        """Add HasPermission edge."""
        self.edges.append((principal_arn, resource_arn, action, event_id))

    def find_attack_paths(self) -> List[AttackPath]:
        """Find all directed paths from any attacker entry to any sensitive target."""
        paths = []

        for entry in self.attacker_entries:
            for target in self.sensitive_targets:
                path = self._find_path(entry, target)
                if path:
                    paths.append(path)

        return paths

    def _find_path(self, start: str, end: str) -> Optional[AttackPath]:
        """BFS to find shortest directed path from start to end."""
        from collections import deque

        queue = deque([(start, [])])
        visited = set([start])

        while queue:
            current, path_edges = queue.popleft()

            if current == end:
                return self._build_attack_path(start, end, path_edges)

            for src, dst, action, evidence_id in self.edges:
                if src == current and dst not in visited:
                    visited.add(dst)
                    queue.append((dst, path_edges + [(src, dst, action, evidence_id)]))

        return None

    def _build_attack_path(
        self,
        entry: str,
        target: str,
        path_edges: List[Tuple[str, str, str, str]]
    ) -> AttackPath:
        steps = []
        evidence_ids = []

        for i, (src, dst, action, evidence_id) in enumerate(path_edges):
            steps.append(AttackPathStep(
                step_number=i + 1,
                source_node=src,
                action=action,
                target_node=dst,
                evidence_event_id=evidence_id
            ))
            if evidence_id != "topology":
                evidence_ids.append(evidence_id)

        return AttackPath(
            initial_compromise=entry,
            target_resource=target,
            steps=steps,
            evidence_event_ids=evidence_ids
        )

    def check_workflow_reachability(
        self,
        workflow: BusinessWorkflow,
        blocked_edges: Optional[Set[Tuple[str, str]]] = None
    ) -> Tuple[bool, Optional[str]]:
        """Check if workflow principal can reach target resource with required action."""
        blocked = blocked_edges or set()

        # Check if required edge exists and is not blocked
        for src, dst, action, _ in self.edges:
            if (
                src == workflow.principal_arn and
                dst == workflow.target_resource_arn and
                action == workflow.required_action
            ):
                if (src, dst) in blocked:
                    return False, f"Edge blocked by remediation: {src} -> {dst}"
                return True, None

        return False, f"No path from {workflow.principal_arn} to {workflow.target_resource_arn} for {workflow.required_action}"


def build_incident_graph(
    events: List[CanonicalEvent],
    principals: List[PrincipalNode],
    roles: List[RoleNode],
    resources: List[ResourceNode],
    workloads: List[WorkloadNode],
    workflows: List[BusinessWorkflow]
) -> IncidentGraph:
    """Builds complete incident graph from normalized events and topology."""
    graph = IncidentGraph()

    for p in principals:
        graph.add_principal(p)
    for r in roles:
        graph.add_role(r)
    for res in resources:
        graph.add_resource(res)
    for w in workloads:
        graph.add_workload(w)

    # Add policy-based edges from topology (trust policies, attached policies)
    for role in roles:
        # Trust policy: who can assume this role
        trust = role.trust_policy
        if trust and "Statement" in trust:
            for stmt in trust["Statement"]:
                if stmt.get("Effect") == "Allow" and "Action" in stmt:
                    if "sts:AssumeRole" in (stmt["Action"] if isinstance(stmt["Action"], list) else [stmt["Action"]]):
                        # Extract principals from condition/principal
                        principal_arns = _extract_principals_from_trust(stmt)
                        for pa in principal_arns:
                            graph.add_can_assume(pa, role.arn, "trust_policy")

    # Add edges from observed canonical events
    for event in events:
        graph.add_observed_action(event)

    # Baseline legitimate access: every business workflow implies its required
    # permission edge so preservation checks do not depend on observed events.
    for workflow in workflows:
        graph.add_permission(
            workflow.principal_arn,
            workflow.target_resource_arn,
            workflow.required_action,
            "topology"
        )

    return graph


def _extract_principals_from_trust(statement: Dict) -> List[str]:
    """Extract principal ARNs from IAM trust policy statement."""
    principals = []
    principal_field = statement.get("Principal", {})
    if isinstance(principal_field, dict):
        if "AWS" in principal_field:
            aws_vals = principal_field["AWS"]
            if isinstance(aws_vals, list):
                principals.extend(aws_vals)
            else:
                principals.append(aws_vals)
        elif "Service" in principal_field:
            # Service principal - skip for now
            pass
    return principals