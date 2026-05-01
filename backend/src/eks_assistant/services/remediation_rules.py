"""Rule-based remediation suggestions (no LLM). Execute separately behind a flag."""

from __future__ import annotations

from typing import Any


def suggestions_for_pod(pod: dict[str, Any]) -> list[dict[str, Any]]:
    """Return suggested actions from native pod summary or full pod inspection."""
    name = pod.get("name") or ""
    namespace = pod.get("namespace") or ""
    phase = (pod.get("phase") or "").strip()
    reason = (pod.get("reason") or "").strip()
    out: list[dict[str, Any]] = []

    if phase == "Pending":
        out.append(
            {
                "id": "describe_pod",
                "risk": "read_only",
                "title": "Inspect scheduling and events",
                "description": "Pod is Pending — often scheduling, image pull, or volumes.",
                "command": f"kubectl describe pod {name} -n {namespace}",
            },
        )
        out.append(
            {
                "id": "check_events",
                "risk": "read_only",
                "title": "List recent events",
                "command": f"kubectl get events -n {namespace} --sort-by=.lastTimestamp | tail -30",
            },
        )

    if phase == "Failed" or reason in {"CrashLoopBackOff", "Error", "OOMKilled"}:
        out.append(
            {
                "id": "logs_previous",
                "risk": "read_only",
                "title": "Logs from previous container instance",
                "command": f"kubectl logs {name} -n {namespace} --previous --tail=200",
            },
        )
        out.append(
            {
                "id": "delete_pod",
                "risk": "destructive",
                "title": "Delete pod (Deployment may recreate)",
                "description": "Recreates the pod; use when stuck on bad node or corrupt ephemeral state.",
                "command": f"kubectl delete pod {name} -n {namespace} --wait=false",
                "execute_kind": "delete_pod",
            },
        )

    if reason == "CrashLoopBackOff":
        out.append(
            {
                "id": "rollout_restart",
                "risk": "moderate",
                "title": "Restart owning Deployment (if applicable)",
                "description": "Pick the correct workload name from labels/ownerReferences.",
                "command": f"kubectl rollout restart deployment/<DEPLOYMENT_NAME> -n {namespace}",
                "execute_kind": "rollout_restart_deployment",
                "note": "Replace <DEPLOYMENT_NAME> after identifying owner.",
            },
        )

    if not out:
        out.append(
            {
                "id": "describe_pod",
                "risk": "read_only",
                "title": "Describe workload",
                "command": f"kubectl describe pod {name} -n {namespace}",
            },
        )

    return out
