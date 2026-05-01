import asyncio
from pathlib import Path

from fastapi import APIRouter

from eks_assistant.api.deps import DbSessionDep, TenantIdDep
from eks_assistant.core.config import get_settings
from eks_assistant.services import kubernetes_service
from eks_assistant.services.cluster_context import resolve_active_kubeconfig

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("/summary", summary="Cluster snapshot from native Kubernetes API")
async def diagnostics_summary(session: DbSessionDep, tenant_id: TenantIdDep) -> dict:
    data_dir = Path(get_settings().data_dir).resolve()
    resolved = await resolve_active_kubeconfig(session, tenant_id, data_dir)
    if resolved is None:
        return {
            "connected": False,
            "message": "No active cluster connection. Complete the Connect wizard and activate a kubeconfig.",
        }

    path, ctx = resolved
    try:
        api = kubernetes_service.build_core_v1(path, ctx)
        pods = await asyncio.to_thread(kubernetes_service.list_pods_sync, api, None)
        ns = await asyncio.to_thread(kubernetes_service.list_namespaces_sync, api)
    except Exception as e:
        return {
            "connected": True,
            "error": str(e),
            "message": "Kubeconfig is active but the Kubernetes API call failed.",
        }

    not_running = [p for p in pods if p.get("phase") not in ("Running", "Succeeded")]

    return {
        "connected": True,
        "kubernetes": await asyncio.to_thread(kubernetes_service.version_info, path, ctx),
        "namespaces": len(ns),
        "pods_total": len(pods),
        "pods_not_healthy": len(not_running),
        "pods_sample": not_running[:12],
        "message": f"{len(not_running)} pod(s) not Running/Succeeded (of {len(pods)}).",
    }
