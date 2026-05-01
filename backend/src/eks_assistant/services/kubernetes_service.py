"""Per-request Kubernetes API client from kubeconfig (isolated configuration)."""

from __future__ import annotations

from typing import Any

from kubernetes import client, config
from kubernetes.client import ApiClient, AppsV1Api, CoreV1Api, VersionApi
from kubernetes.client.rest import ApiException


def _api_client(kubeconfig_path: str, context: str | None = None) -> ApiClient:
    configuration = client.Configuration()
    config.load_kube_config(
        config_file=kubeconfig_path,
        context=context,
        client_configuration=configuration,
    )
    return client.ApiClient(configuration)


def build_core_v1(kubeconfig_path: str, context: str | None = None) -> CoreV1Api:
    return CoreV1Api(_api_client(kubeconfig_path, context))


def build_apps_v1(kubeconfig_path: str, context: str | None = None) -> AppsV1Api:
    return AppsV1Api(_api_client(kubeconfig_path, context))


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
        spec = pod.spec
        out.append(
            {
                "namespace": pod.metadata.namespace,
                "name": pod.metadata.name,
                "phase": status.phase if status else None,
                "reason": status.reason if status else None,
                "message": status.message if status else None,
                "node_name": spec.node_name if spec else None,
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
    spec = pod.spec
    meta = pod.metadata
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
    containers = [c.name for c in (spec.containers or [])] if spec else []
    init_containers = [c.name for c in (spec.init_containers or [])] if spec else []

    container_specs: list[dict[str, Any]] = []
    if spec and spec.containers:
        for c in spec.containers:
            entry: dict[str, Any] = {"name": c.name, "image": c.image or ""}
            if c.resources:
                res: dict[str, Any] = {}
                if c.resources.requests:
                    res["requests"] = {k: str(v) for k, v in dict(c.resources.requests).items()}
                if c.resources.limits:
                    res["limits"] = {k: str(v) for k, v in dict(c.resources.limits).items()}
                if res:
                    entry["resources"] = res
            container_specs.append(entry)

    annotations = dict(meta.annotations or {})
    if len(annotations) > 24:
        keys = sorted(annotations.keys())[:24]
        annotations = {k: annotations[k] for k in keys}
        annotations["_truncated"] = "true"

    created = None
    if meta.creation_timestamp:
        created = meta.creation_timestamp.isoformat()

    return {
        "namespace": meta.namespace,
        "name": meta.name,
        "created": created,
        "phase": status.phase if status else None,
        "qos_class": status.qos_class if status else None,
        "reason": status.reason if status else None,
        "node_name": spec.node_name if spec else None,
        "service_account": spec.service_account_name if spec else None,
        "labels": dict(meta.labels or {}),
        "annotations": annotations,
        "containers": containers,
        "init_containers": init_containers,
        "container_specs": container_specs,
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


def list_nodes_sync(api: CoreV1Api) -> list[dict[str, Any]]:
    """List nodes with fields used by Cluster explorer and Compute summary."""
    out: list[dict[str, Any]] = []
    for n in api.list_node().items:
        meta = n.metadata
        labels = dict(meta.labels or {})
        st = n.status
        ready = None
        if st and st.conditions:
            for c in st.conditions:
                if c.type == "Ready":
                    ready = c.status
                    break
        internal_ip = None
        if st and st.addresses:
            for a in st.addresses:
                if a.type == "InternalIP":
                    internal_ip = a.address
                    break
        alloc = dict(st.allocatable or {}) if st else {}
        cap = dict(st.capacity or {}) if st else {}
        created = None
        if meta.creation_timestamp:
            created = meta.creation_timestamp.isoformat()
        out.append(
            {
                "name": meta.name,
                "ready": ready,
                "internal_ip": internal_ip,
                "kubelet_version": st.node_info.kubelet_version if st and st.node_info else None,
                "os_image": st.node_info.os_image if st and st.node_info else None,
                "created": created,
                "instance_type": labels.get("node.kubernetes.io/instance-type"),
                "eks_nodegroup": labels.get("eks.amazonaws.com/nodegroup"),
                "capacity_type": labels.get("eks.amazonaws.com/capacityType"),
                "eks_compute_type": labels.get("eks.amazonaws.com/compute-type"),
                "zone": labels.get("topology.kubernetes.io/zone")
                or labels.get("failure-domain.beta.kubernetes.io/zone"),
                "allocatable_cpu": alloc.get("cpu"),
                "allocatable_memory": alloc.get("memory"),
                "allocatable_ephemeral_storage": alloc.get("ephemeral-storage"),
                "capacity_ephemeral_storage": cap.get("ephemeral-storage"),
            },
        )
    return out


def fetch_node_metrics_sync(core_api: CoreV1Api) -> dict[str, dict[str, str]]:
    """metrics.k8s.io NodeMetrics; empty dict if metrics-server not installed."""
    custom = client.CustomObjectsApi(core_api.api_client)
    try:
        raw = custom.list_cluster_custom_object(
            group="metrics.k8s.io",
            version="v1beta1",
            plural="nodes",
        )
    except ApiException:
        return {}
    out: dict[str, dict[str, str]] = {}
    for item in raw.get("items") or []:
        name = item.get("metadata", {}).get("name")
        usage = item.get("usage") or {}
        if not name:
            continue
        cpu = usage.get("cpu")
        mem = usage.get("memory")
        out[name] = {
            "cpu": str(cpu) if cpu is not None else "",
            "memory": str(mem) if mem is not None else "",
        }
    return out


def _cpu_str_to_millicores(s: str | None) -> float | None:
    if not s:
        return None
    x = str(s).strip()
    if x.endswith("n"):
        return float(x[:-1]) / 1_000_000.0
    if x.endswith("u"):
        return float(x[:-1]) / 1000.0
    if x.endswith("m"):
        return float(x[:-1])
    try:
        return float(x) * 1000.0
    except ValueError:
        return None


def _memory_str_to_bytes(s: str | None) -> float | None:
    """Parse Kubernetes quantity for memory (Ki, Mi, Gi, K, M, G suffixes)."""
    if not s:
        return None
    x = str(s).strip()
    mult = 1.0
    for suf, m in (
        ("Ki", 1024.0),
        ("Mi", 1024.0**2),
        ("Gi", 1024.0**3),
        ("Ti", 1024.0**4),
        ("K", 1000.0),
        ("M", 1000.0**2),
        ("G", 1000.0**3),
    ):
        if x.endswith(suf):
            try:
                return float(x[: -len(suf)]) * m
            except ValueError:
                return None
    try:
        return float(x)
    except ValueError:
        return None


def merge_node_metrics_percentages(
    nodes: list[dict[str, Any]],
    metrics: dict[str, dict[str, str]],
) -> None:
    """Mutates nodes in place with cpu_usage_percent, memory_usage_percent when metrics-server exists."""
    for row in nodes:
        name = row.get("name")
        if not name or name not in metrics:
            continue
        u_cpu = _cpu_str_to_millicores(metrics[name].get("cpu"))
        u_mem = _memory_str_to_bytes(metrics[name].get("memory"))
        a_cpu = _cpu_str_to_millicores(row.get("allocatable_cpu"))
        a_mem = _memory_str_to_bytes(row.get("allocatable_memory"))
        if u_cpu is not None and a_cpu and a_cpu > 0:
            row["cpu_usage_percent"] = round(100.0 * u_cpu / a_cpu, 1)
        if u_mem is not None and a_mem and a_mem > 0:
            row["memory_usage_percent"] = round(100.0 * u_mem / a_mem, 1)


def aggregate_eks_node_groups(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Derive node group rows from EKS node labels (no AWS API)."""
    from collections import defaultdict

    buckets: dict[str, list[str]] = defaultdict(list)
    unlabeled: list[str] = []
    for row in nodes:
        nm = row.get("name")
        if not nm:
            continue
        ng = row.get("eks_nodegroup")
        if ng:
            buckets[str(ng)].append(nm)
        else:
            unlabeled.append(nm)
    result = [
        {
            "group_name": name,
            "node_count": len(members),
            "nodes": members,
        }
        for name, members in sorted(buckets.items())
    ]
    if unlabeled:
        result.append(
            {
                "group_name": "(no eks.amazonaws.com/nodegroup label)",
                "node_count": len(unlabeled),
                "nodes": unlabeled,
            },
        )
    return result


def list_fargate_profile_hints_sync(api: CoreV1Api) -> list[dict[str, Any]]:
    """Fargate profiles inferred from pods carrying eks.amazonaws.com/fargate-profile."""
    by_prof: dict[str, set[str]] = {}
    try:
        pods = api.list_pod_for_all_namespaces().items
    except ApiException:
        return []
    for pod in pods:
        labels = dict(pod.metadata.labels or {})
        prof = labels.get("eks.amazonaws.com/fargate-profile")
        if prof:
            ns = pod.metadata.namespace or ""
            by_prof.setdefault(str(prof), set()).add(ns)
    return [
        {
            "profile_name": name,
            "namespaces": sorted(ns_set),
            "namespace_count": len(ns_set),
        }
        for name, ns_set in sorted(by_prof.items())
    ]


def list_services_sync(api: CoreV1Api) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for svc in api.list_service_for_all_namespaces().items:
        spec = svc.spec
        st = svc.status
        out.append(
            {
                "namespace": svc.metadata.namespace,
                "name": svc.metadata.name,
                "type": spec.type if spec else None,
                "cluster_ip": spec.cluster_ip if spec else None,
                "external_ip": (
                    st.load_balancer.ingress[0].hostname
                    if st
                    and st.load_balancer
                    and st.load_balancer.ingress
                    and len(st.load_balancer.ingress) > 0
                    and st.load_balancer.ingress[0].hostname
                    else (
                        st.load_balancer.ingress[0].ip
                        if st
                        and st.load_balancer
                        and st.load_balancer.ingress
                        and len(st.load_balancer.ingress) > 0
                        else None
                    )
                ),
            },
        )
    return out


def list_addon_daemonsets_sync(api_apps: AppsV1Api, namespace: str = "kube-system") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        lst = api_apps.list_namespaced_daemon_set(namespace=namespace)
    except ApiException:
        return []
    for ds in lst.items:
        st = ds.status
        out.append(
            {
                "namespace": ds.metadata.namespace,
                "name": ds.metadata.name,
                "desired": st.desired_number_scheduled if st else None,
                "ready": st.number_ready if st else None,
                "updated": st.updated_number_scheduled if st else None,
            },
        )
    return out


def read_pod_logs_sync(
    api: CoreV1Api,
    namespace: str,
    name: str,
    *,
    container: str | None,
    tail_lines: int,
) -> str:
    return api.read_namespaced_pod_log(
        name=name,
        namespace=namespace,
        container=container,
        tail_lines=tail_lines,
    )


def read_node_sync(api: CoreV1Api, name: str) -> dict[str, Any]:
    node = api.read_node(name=name)
    status = node.status
    addresses = []
    if status and status.addresses:
        for a in status.addresses:
            addresses.append({"type": a.type, "address": a.address})
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
        "name": node.metadata.name,
        "labels": dict(node.metadata.labels or {}),
        "addresses": addresses,
        "capacity": dict(status.capacity or {}) if status else {},
        "allocatable": dict(status.allocatable or {}) if status else {},
        "conditions": conditions,
        "node_info": (
            {
                "kubelet_version": status.node_info.kubelet_version,
                "os_image": status.node_info.os_image,
                "kernel_version": status.node_info.kernel_version,
                "container_runtime": status.node_info.container_runtime_version,
            }
            if status and status.node_info
            else {}
        ),
    }


__all__ = [
    "ApiException",
    "aggregate_eks_node_groups",
    "build_apps_v1",
    "build_core_v1",
    "fetch_node_metrics_sync",
    "list_addon_daemonsets_sync",
    "list_events_sync",
    "list_fargate_profile_hints_sync",
    "list_namespaces_sync",
    "list_nodes_sync",
    "list_pods_sync",
    "list_services_sync",
    "merge_node_metrics_percentages",
    "read_node_sync",
    "read_pod_logs_sync",
    "read_pod_sync",
    "version_info",
]
