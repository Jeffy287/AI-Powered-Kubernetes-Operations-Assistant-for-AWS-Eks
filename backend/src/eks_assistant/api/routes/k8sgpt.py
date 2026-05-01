import asyncio
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status

from eks_assistant.api.deps import DbSessionDep, TenantIdDep
from eks_assistant.api.schemas.k8sgpt import K8sGPTAnalyzeRequest, K8sGPTAnalyzeResponse
from eks_assistant.core.config import get_settings
from eks_assistant.services import k8sgpt_runner
from eks_assistant.services.cluster_context import resolve_active_kubeconfig

router = APIRouter(prefix="/diagnostics/k8sgpt", tags=["k8sgpt"])


def _k8sgpt_env_for_tenant(kubeconfig_path: str | None) -> dict[str, str] | None:
    if kubeconfig_path is None:
        return None
    env = os.environ.copy()
    env["KUBECONFIG"] = kubeconfig_path
    return env


@router.get("/version", summary="Check K8sGPT CLI availability")
async def k8sgpt_version(
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict[str, Any]:
    settings = get_settings()
    data_dir = Path(settings.data_dir).resolve()
    resolved = await resolve_active_kubeconfig(session, tenant_id, data_dir)
    env = _k8sgpt_env_for_tenant(resolved[0] if resolved else None)

    try:
        res = await k8sgpt_runner.run_version(
            settings.k8sgpt_binary,
            timeout=float(settings.k8sgpt_timeout_seconds),
            env=env,
        )
    except k8sgpt_runner.K8sGPTNotInstalledError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        ) from e
    except asyncio.TimeoutError as e:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="k8sgpt version timed out",
        ) from e

    return {
        "installed": True,
        "binary": settings.k8sgpt_binary,
        "exit_code": res.exit_code,
        "stdout": res.stdout,
        "stderr": res.stderr or None,
        "kubeconfig_bound": resolved is not None,
    }


@router.post("/analyze", summary="Run k8sgpt analyze --output json")
async def k8sgpt_analyze(
    body: K8sGPTAnalyzeRequest,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> K8sGPTAnalyzeResponse:
    settings = get_settings()
    data_dir = Path(settings.data_dir).resolve()
    resolved = await resolve_active_kubeconfig(session, tenant_id, data_dir)
    env = _k8sgpt_env_for_tenant(resolved[0] if resolved else None)

    try:
        result = await k8sgpt_runner.run_analyze(
            settings.k8sgpt_binary,
            timeout=float(settings.k8sgpt_timeout_seconds),
            namespace=body.namespace,
            explain=body.explain,
            filters=body.filters,
            env=env,
        )
    except k8sgpt_runner.K8sGPTNotInstalledError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        ) from e
    except asyncio.TimeoutError as e:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="k8sgpt analyze timed out",
        ) from e
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        ) from e

    if result.exit_code != 0:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "k8sgpt analyze exited with non-zero status",
                "exit_code": result.exit_code,
                "stderr": result.stderr or None,
            },
        )

    return K8sGPTAnalyzeResponse(
        exit_code=result.exit_code,
        stderr=result.stderr or None,
        result=result.parsed,
    )
