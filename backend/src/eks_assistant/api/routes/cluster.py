"""Native Kubernetes reads via official client (no K8sGPT)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status
from kubernetes.client.rest import ApiException
from sqlalchemy.ext.asyncio import AsyncSession

from eks_assistant.api.deps import DbSessionDep, TenantIdDep
from eks_assistant.core.config import get_settings
from eks_assistant.services import kubernetes_service
from eks_assistant.services.cluster_context import resolve_active_kubeconfig

router = APIRouter(prefix="/cluster", tags=["cluster"])


def _data_dir() -> Path:
    return Path(get_settings().data_dir).resolve()


def _detail_from_api_exception(exc: ApiException) -> str:
    body = exc.body
    if body:
        try:
            raw = body.decode("utf-8") if isinstance(body, bytes) else body
            data = json.loads(raw)
            if isinstance(data, dict) and data.get("message"):
                return str(data["message"])
        except Exception:
            pass
        return str(body)
    return exc.reason or str(exc)


def _raise_from_api_exception(exc: ApiException) -> None:
    """Map kubernetes.client ApiException to FastAPI HTTP errors (avoid generic 500)."""
    code = int(exc.status) if exc.status else 502
    if code == 404:
        http_status = status.HTTP_404_NOT_FOUND
    elif code == 403:
        http_status = status.HTTP_403_FORBIDDEN
    elif code == 401:
        http_status = status.HTTP_401_UNAUTHORIZED
    elif code == 408:
        http_status = status.HTTP_408_REQUEST_TIMEOUT
    else:
        http_status = status.HTTP_502_BAD_GATEWAY
    raise HTTPException(http_status, detail=_detail_from_api_exception(exc)) from exc


async def _core_api(session: AsyncSession, tenant_id: str):
    resolved = await resolve_active_kubeconfig(session, tenant_id, _data_dir())
    if resolved is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="No active cluster connection. Complete the Connect wizard first.",
        )
    path, ctx = resolved
    try:
        return kubernetes_service.build_core_v1(path, ctx), path, ctx
    except Exception as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid kubeconfig or context: {e}",
        ) from e


async def _apps_api(session: AsyncSession, tenant_id: str):
    resolved = await resolve_active_kubeconfig(session, tenant_id, _data_dir())
    if resolved is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="No active cluster connection. Complete the Connect wizard first.",
        )
    path, ctx = resolved
    try:
        return kubernetes_service.build_apps_v1(path, ctx), path, ctx
    except Exception as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid kubeconfig or context: {e}",
        ) from e


@router.get("/namespaces", summary="List namespaces")
async def namespaces(session: DbSessionDep, tenant_id: TenantIdDep) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    try:
        items = await asyncio.to_thread(kubernetes_service.list_namespaces_sync, api)
    except ApiException as e:
        _raise_from_api_exception(e)
    return {"items": items}


@router.get("/pods", summary="List pods (all namespaces or filtered)")
async def pods(
    session: DbSessionDep,
    tenant_id: TenantIdDep,
    namespace: str | None = Query(None, description="omit for all namespaces"),
) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    try:
        items = await asyncio.to_thread(kubernetes_service.list_pods_sync, api, namespace)
    except ApiException as e:
        _raise_from_api_exception(e)
    return {"items": items, "namespace_filter": namespace}


@router.get("/nodes", summary="List nodes")
async def list_nodes(session: DbSessionDep, tenant_id: TenantIdDep) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    try:
        items = await asyncio.to_thread(kubernetes_service.list_nodes_sync, api)
    except ApiException as e:
        _raise_from_api_exception(e)
    return {"items": items}


@router.get("/compute-summary", summary="Compute view: nodes, derived node groups, Fargate hints")
async def compute_summary(session: DbSessionDep, tenant_id: TenantIdDep) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    try:
        nodes = await asyncio.to_thread(kubernetes_service.list_nodes_sync, api)
        metrics = await asyncio.to_thread(kubernetes_service.fetch_node_metrics_sync, api)
        kubernetes_service.merge_node_metrics_percentages(nodes, metrics)
        groups = kubernetes_service.aggregate_eks_node_groups(nodes)
        fargate = await asyncio.to_thread(
            kubernetes_service.list_fargate_profile_hints_sync,
            api,
        )
    except ApiException as e:
        _raise_from_api_exception(e)
    return {
        "nodes": nodes,
        "node_groups": groups,
        "fargate_profiles": fargate,
        "metrics_available": bool(metrics),
    }


@router.get("/services", summary="List services (all namespaces)")
async def list_services_route(session: DbSessionDep, tenant_id: TenantIdDep) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    try:
        items = await asyncio.to_thread(kubernetes_service.list_services_sync, api)
    except ApiException as e:
        _raise_from_api_exception(e)
    return {"items": items}


@router.get(
    "/addons/daemonsets",
    summary="DaemonSets in kube-system (common cluster add-ons)",
)
async def addon_daemonsets(session: DbSessionDep, tenant_id: TenantIdDep) -> dict:
    api_apps, _, _ = await _apps_api(session, tenant_id)
    try:
        items = await asyncio.to_thread(
            kubernetes_service.list_addon_daemonsets_sync,
            api_apps,
            "kube-system",
        )
    except ApiException as e:
        _raise_from_api_exception(e)
    return {"namespace": "kube-system", "items": items}


@router.get("/events", summary="Recent events")
async def events(
    session: DbSessionDep,
    tenant_id: TenantIdDep,
    namespace: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    try:
        items = await asyncio.to_thread(
            kubernetes_service.list_events_sync,
            api,
            namespace,
            limit=limit,
        )
    except ApiException as e:
        _raise_from_api_exception(e)
    return {"items": items, "namespace_filter": namespace}


@router.get(
    "/pods/{namespace}/{pod_name}/logs",
    summary="Pod container logs (tail)",
)
async def pod_logs(
    namespace: str,
    pod_name: str,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
    container: str | None = Query(None, description="required when pod has multiple containers"),
    tail_lines: int = Query(500, ge=1, le=10000),
) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    try:
        text = await asyncio.to_thread(
            kubernetes_service.read_pod_logs_sync,
            api,
            namespace,
            pod_name,
            container=container,
            tail_lines=tail_lines,
        )
    except ApiException as e:
        _raise_from_api_exception(e)
    return {"logs": text, "container": container}


@router.get("/nodes/{node_name}", summary="Node detail (capacity, addresses)")
async def node_detail(
    node_name: str,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    try:
        detail = await asyncio.to_thread(
            kubernetes_service.read_node_sync,
            api,
            node_name,
        )
    except ApiException as e:
        _raise_from_api_exception(e)
    return detail


@router.get("/pods/{namespace}/{pod_name}", summary="Pod detail for remediation hints")
async def pod_detail(
    namespace: str,
    pod_name: str,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    try:
        detail = await asyncio.to_thread(
            kubernetes_service.read_pod_sync,
            api,
            namespace,
            pod_name,
        )
    except ApiException as e:
        _raise_from_api_exception(e)
    return detail


@router.get("/version", summary="Kubernetes version from active connection")
async def k8s_version(session: DbSessionDep, tenant_id: TenantIdDep) -> dict:
    resolved = await resolve_active_kubeconfig(session, tenant_id, _data_dir())
    if resolved is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="No active cluster connection.",
        )
    path, ctx = resolved
    try:
        ver = await asyncio.to_thread(kubernetes_service.version_info, path, ctx)
    except Exception as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return ver
