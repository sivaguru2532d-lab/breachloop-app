"""Digital Twin Simulator - In-Process State Machine for Remediation Validation."""

import copy
from typing import List, Dict, Any, Set, Optional, Tuple
from breachloop.models import (
    TwinState,
    SimulationResult,
    SimulationStatus,
    ReachabilityState,
    WorkflowVerification,
    RemediationCandidate,
    RemediationType,
    BusinessWorkflow,
    CanonicalEvent,
    PrincipalNode,
    RoleNode,
    ResourceNode,
    WorkloadNode,
    AttackPath,
    AttackPathStep,
)
from .graph import IncidentGraph, build_incident_graph


class DigitalTwin:
    """In-process digital twin simulator for remediation candidate validation.

    Deep-clones baseline state, applies typed remediation actions, and verifies
    attacker reachability and business workflow health.
    """

    def __init__(self, baseline_state: TwinState):
        self.baseline = baseline_state

    def simulate(self, candidate: RemediationCandidate) -> SimulationResult:
        """Execute simulation for a single remediation candidate."""
        # Deep clone baseline state
        twin_state = self._deep_clone_state(self.baseline)

        # Compute before reachability (baseline, no blocks applied)
        before_reach = self._compute_reachability(twin_state)

        # Apply remediation to cloned state
        blocked_edges = self._apply_remediation(twin_state, candidate)

        # Compute after reachability with remediation blocks applied
        after_reach = self._compute_reachability(twin_state, blocked_edges)

        # Verify business workflows
        workflow_results = self._verify_workflows(twin_state, blocked_edges)

        # Determine status
        status, reason = self._determine_status(
            candidate, before_reach, after_reach, workflow_results
        )

        # Build proof details
        proof = self._build_proof(
            candidate, twin_state, before_reach, after_reach, workflow_results
        )

        return SimulationResult(
            remediation_id=candidate.id,
            remediation_title=candidate.title,
            status=status,
            reason=reason,
            before_reachability=before_reach,
            after_reachability=after_reach,
            workflow_results=workflow_results,
            proof_details=proof
        )

    def _deep_clone_state(self, state: TwinState) -> TwinState:
        """Create independent deep copy of twin state."""
        return TwinState(
            principals=copy.deepcopy(state.principals),
            roles=copy.deepcopy(state.roles),
            resources=copy.deepcopy(state.resources),
            workloads=copy.deepcopy(state.workloads),
            workflows=copy.deepcopy(state.workflows),
            active_policies=copy.deepcopy(state.active_policies),
            observed_events=copy.deepcopy(state.observed_events)
        )

    def _apply_remediation(
        self,
        state: TwinState,
        candidate: RemediationCandidate
    ) -> Set[Tuple[str, str]]:
        """Apply typed remediation action to twin state. Returns blocked edges."""
        blocked_edges = set()

        if candidate.remediation_type == RemediationType.REVOKE_ROLE_SESSIONS:
            blocked_edges = self._apply_revoke_role_sessions(state, candidate)

        elif candidate.remediation_type == RemediationType.REMOVE_RESOURCE_PERMISSION:
            blocked_edges = self._apply_remove_resource_permission(state, candidate)

        elif candidate.remediation_type == RemediationType.ISOLATE_WORKLOAD:
            blocked_edges = self._apply_isolate_workload(state, candidate)

        elif candidate.remediation_type == RemediationType.ATTACH_INLINE_DENY:
            blocked_edges = self._apply_attach_inline_deny(state, candidate)

        else:
            # Unknown action - will result in unverified
            pass

        return blocked_edges

    def _apply_revoke_role_sessions(
        self,
        state: TwinState,
        candidate: RemediationCandidate
    ) -> Set[Tuple[str, str]]:
        """Revoke role sessions - blocks edges TO and FROM the target role.

        Revoking sessions both prevents new sessions from being established on
        the role and invalidates any action performed through existing sessions.
        """
        target_arn = candidate.parameters.get("role_arn", candidate.target_arn)
        blocked = set()

        if target_arn not in state.roles:
            return blocked

        # The role's existing sessions can no longer act on any resource.
        graph = self._build_graph_from_state(state)
        for src, dst, _, _ in graph.edges:
            if src == target_arn:
                blocked.add((src, dst))

        # No principal or role can establish a new session on the revoked role.
        for arn in list(state.principals) + list(state.roles):
            blocked.add((arn, target_arn))

        return blocked

    def _apply_remove_resource_permission(
        self,
        state: TwinState,
        candidate: RemediationCandidate
    ) -> Set[Tuple[str, str]]:
        """Remove resource permission - blocks specific principal/action/resource edge."""
        blocked = set()

        denied_principal = candidate.parameters.get("denied_principal_arn")
        denied_action = candidate.parameters.get("denied_action")
        denied_resource = candidate.parameters.get("denied_resource_arn", candidate.target_arn)

        if denied_principal and denied_action and denied_resource:
            # Block the specific edge
            blocked.add((denied_principal, denied_resource))

        return blocked

    def _apply_isolate_workload(
        self,
        state: TwinState,
        candidate: RemediationCandidate
    ) -> Set[Tuple[str, str]]:
        """Isolate workload - blocks all network edges from workload."""
        blocked = set()
        workload_arn = candidate.parameters.get("workload_arn", candidate.target_arn)

        # Block workload -> role edge
        if workload_arn in state.workloads:
            role_arn = state.workloads[workload_arn].execution_role_arn
            blocked.add((workload_arn, role_arn))

        return blocked

    def _apply_attach_inline_deny(
        self,
        state: TwinState,
        candidate: RemediationCandidate
    ) -> Set[Tuple[str, str]]:
        """Attach inline deny - similar to remove_resource_permission."""
        return self._apply_remove_resource_permission(state, candidate)

    def _compute_reachability(
        self,
        state: TwinState,
        blocked_edges: Optional[Set[Tuple[str, str]]] = None
    ) -> ReachabilityState:
        """Compute attacker-to-target reachability from current twin state.

        When blocked_edges is provided, those edges are removed before pathfinding
        so remediation effects are reflected in reachability.
        """
        graph = self._build_graph_from_state(state)
        if blocked_edges:
            graph.edges = [
                edge for edge in graph.edges
                if (edge[0], edge[1]) not in blocked_edges
            ]
        attack_paths = graph.find_attack_paths()

        if attack_paths:
            primary = attack_paths[0]
            return ReachabilityState(
                attacker_entry_arn=primary.initial_compromise,
                target_resource_arn=primary.target_resource,
                is_reachable=True,
                path_summary=f"Path length {len(primary.steps)} steps via {' -> '.join(s.action for s in primary.steps)}"
            )
        else:
            # Find any attacker entry and sensitive target
            attacker = next(iter(graph.attacker_entries), "unknown")
            target = next(iter(graph.sensitive_targets), "unknown")
            return ReachabilityState(
                attacker_entry_arn=attacker,
                target_resource_arn=target,
                is_reachable=False,
                path_summary="No path from attacker to sensitive resource"
            )

    def _build_graph_from_state(self, state: TwinState) -> IncidentGraph:
        """Rebuild incident graph from twin state."""
        return build_incident_graph(
            events=list(state.observed_events),
            principals=list(state.principals.values()),
            roles=list(state.roles.values()),
            resources=list(state.resources.values()),
            workloads=list(state.workloads.values()),
            workflows=state.workflows
        )

    def _verify_workflows(
        self,
        state: TwinState,
        blocked_edges: Set[Tuple[str, str]]
    ) -> List[WorkflowVerification]:
        """Verify all business workflows are operational under remediation."""
        results = []
        graph = self._build_graph_from_state(state)

        for workflow in state.workflows:
            is_operational, failure_reason = graph.check_workflow_reachability(
                workflow, blocked_edges
            )
            results.append(WorkflowVerification(
                workflow_id=workflow.id,
                workflow_name=workflow.name,
                is_operational=is_operational,
                failure_reason=failure_reason
            ))

        return results

    def _determine_status(
        self,
        candidate: RemediationCandidate,
        before: ReachabilityState,
        after: ReachabilityState,
        workflows: List[WorkflowVerification]
    ) -> Tuple[SimulationStatus, str]:
        """Determine simulation status based on reachability and workflow health."""

        attacker_stopped = not after.is_reachable
        workflows_broken = [w for w in workflows if not w.is_operational]

        if not attacker_stopped:
            return SimulationStatus.REJECTED, "Attack path remains reachable after remediation"

        if workflows_broken:
            broken_names = ", ".join(w.workflow_name for w in workflows_broken)
            return SimulationStatus.REJECTED, f"Disrupts business workflow(s): {broken_names}"

        return SimulationStatus.VERIFIED, "Attack reachability blocked, all business workflows preserved"

    def _build_proof(
        self,
        candidate: RemediationCandidate,
        state: TwinState,
        before: ReachabilityState,
        after: ReachabilityState,
        workflows: List[WorkflowVerification]
    ) -> Dict[str, Any]:
        """Build detailed proof artifact for verification."""
        broken = [w for w in workflows if not w.is_operational]
        operational = [w for w in workflows if w.is_operational]

        return {
            "remediation_type": candidate.remediation_type.value,
            "target_arn": candidate.target_arn,
            "parameters": candidate.parameters,
            "before": {
                "attacker_reachable": before.is_reachable,
                "path": before.path_summary
            },
            "after": {
                "attacker_reachable": after.is_reachable,
                "path": after.path_summary
            },
            "workflows": {
                "operational": [w.workflow_name for w in operational],
                "broken": [
                    {"name": w.workflow_name, "reason": w.failure_reason}
                    for w in broken
                ]
            },
            "is_broad_fix": candidate.is_broad
        }


def create_baseline_twin_state(
    principals: List[PrincipalNode],
    roles: List[RoleNode],
    resources: List[ResourceNode],
    workloads: List[WorkloadNode],
    workflows: List[BusinessWorkflow],
    events: Optional[List[CanonicalEvent]] = None
) -> TwinState:
    """Create baseline TwinState from scenario topology and observed events."""
    return TwinState(
        principals={p.arn: p for p in principals},
        roles={r.arn: r for r in roles},
        resources={res.arn: res for res in resources},
        workloads={w.arn: w for w in workloads},
        workflows=workflows,
        active_policies=[],
        observed_events=list(events or [])
    )