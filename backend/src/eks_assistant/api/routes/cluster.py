"""Native Kubernetes reads via official client (no K8sGPT)."""

from __future__ import annotations

import asyncio
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


@router.get("/namespaces", summary="List namespaces")
async def namespaces(session: DbSessionDep, tenant_id: TenantIdDep) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    items = await asyncio.to_thread(kubernetes_service.list_namespaces_sync, api)
    return {"items": items}


@router.get("/pods", summary="List pods (all namespaces or filtered)")
async def pods(
    session: DbSessionDep,
    tenant_id: TenantIdDep,
    namespace: str | None = Query(None, description="omit for all namespaces"),
) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    items = await asyncio.to_thread(kubernetes_service.list_pods_sync, api, namespace)
    return {"items": items, "namespace_filter": namespace}


@router.get("/events", summary="Recent events")
async def events(
    session: DbSessionDep,
    tenant_id: TenantIdDep,
    namespace: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
) -> dict:
    api, _, _ = await _core_api(session, tenant_id)
    items = await asyncio.to_thread(
        kubernetes_service.list_events_sync,
        api,
        namespace,
        limit=limit,
    )
    return {"items": items, "namespace_filter": namespace}


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
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=e.reason or str(e)) from e
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
