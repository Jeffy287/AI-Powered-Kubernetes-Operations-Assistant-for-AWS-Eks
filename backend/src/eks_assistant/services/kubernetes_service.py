"""Per-request Kubernetes API client from kubeconfig (isolated configuration)."""

from __future__ import annotations

from typing import Any

from kubernetes import client, config
from kubernetes.client import CoreV1Api, VersionApi
from kubernetes.client.rest import ApiException


def build_core_v1(kubeconfig_path: str, context: str | None = None) -> CoreV1Api:
    configuration = client.Configuration()
    config.load_kube_config(
        config_file=kubeconfig_path,
        context=context,
        client_configuration=configuration,
    )
    api_client = client.ApiClient(configuration)
    return CoreV1Api(api_client)


def build_version_api(kubeconfig_path: str, context: str | None = None) -> VersionApi:
    configuration = client.Configuration()
    config.load_kube_config(
        config_file=kubeconfig_path,
        context=context,
        client_configuration=configuration,
    )
    api_client = client.ApiClient(configuration)
    return VersionApi(api_client)


def version_info(kubeconfig_path: str, context: str | None = None) -> dict[str, str]:
    v = build_version_api(kubeconfig_path, context)
    code = v.get_code()
    return {
        "major": str(code.major or ""),
        "minor": str(code.minor or ""),
        "git_version": str(code.git_version or ""),
    }


def list_namespaces_sync(api: CoreV1Api) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ns in api.list_namespace().items:
        out.append(
            {
                "name": ns.metadata.name,
                "phase": ns.status.phase,
            },
        )
    return out


def list_pods_sync(api: CoreV1Api, namespace: str | None) -> list[dict[str, Any]]:
    if namespace:
        items = api.list_namespaced_pod(namespace=namespace).items
    else:
        items = api.list_pod_for_all_namespaces().items
    out: list[dict[str, Any]] = []
    for pod in items:
        status = pod.status
        out.append(
            {
                "namespace": pod.metadata.namespace,
                "name": pod.metadata.name,
                "phase": status.phase if status else None,
                "reason": status.reason if status else None,
                "message": status.message if status else None,
                "containers_ready": sum(
                    1 for c in (status.container_statuses or []) if getattr(c, "ready", False)
                ),
                "container_count": len(pod.spec.containers) if pod.spec else 0,
            },
        )
    return out


def list_events_sync(
    api: CoreV1Api,
    namespace: str | None,
    *,
    limit: int = 50,
) -> list[dict[str, Any]]:
    if namespace:
        stream = api.list_namespaced_event(namespace=namespace, limit=limit)
        items = stream.items
    else:
        items = api.list_event_for_all_namespaces(limit=limit).items
    out: list[dict[str, Any]] = []
    for ev in items:
        out.append(
            {
                "namespace": ev.metadata.namespace,
                "type": ev.type,
                "reason": ev.reason,
                "message": ev.message,
                "involved_object": (
                    f"{ev.involved_object.kind}/{ev.involved_object.name}"
                    if ev.involved_object
                    else None
                ),
                "first_timestamp": ev.first_timestamp.isoformat() if ev.first_timestamp else None,
                "last_timestamp": ev.last_timestamp.isoformat() if ev.last_timestamp else None,
            },
        )
    return out


def read_pod_sync(api: CoreV1Api, namespace: str, name: str) -> dict[str, Any]:
    pod = api.read_namespaced_pod(name=name, namespace=namespace)
    status = pod.status
    conditions = []
    if status and status.conditions:
        for c in status.conditions:
            conditions.append(
                {
                    "type": c.type,
                    "status": c.status,
                    "reason": c.reason,
                    "message": c.message,
                },
            )
    return {
        "namespace": pod.metadata.namespace,
        "name": pod.metadata.name,
        "phase": status.phase if status else None,
        "reason": status.reason if status else None,
        "conditions": conditions,
        "container_statuses": [
            {
                "name": cs.name,
                "ready": cs.ready,
                "restart_count": cs.restart_count,
                "state": (
                    cs.state.waiting.reason
                    if cs.state and cs.state.waiting
                    else (cs.state.terminated.reason if cs.state and cs.state.terminated else None)
                ),
            }
            for cs in (status.container_statuses or [])
        ]
        if status
        else [],
    }


__all__ = [
    "ApiException",
    "build_core_v1",
    "list_events_sync",
    "list_namespaces_sync",
    "list_pods_sync",
    "read_pod_sync",
    "version_info",
]
