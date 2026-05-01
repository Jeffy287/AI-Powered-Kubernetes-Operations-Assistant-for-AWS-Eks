"""Suggested fixes (rules) and optional guarded kubectl execution."""

from __future__ import annotations

import asyncio
import os
import re
import shutil
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from eks_assistant.api.deps import DbSessionDep, TenantIdDep
from eks_assistant.core.config import get_settings
from eks_assistant.db.models import RemediationAudit
from kubernetes.client.rest import ApiException

from eks_assistant.services import kubernetes_service
from eks_assistant.services.cluster_context import resolve_active_kubeconfig
from eks_assistant.services.remediation_rules import suggestions_for_pod

router = APIRouter(prefix="/remediation", tags=["remediation"])

K8S_SEGMENT = re.compile(r"^[a-z0-9]([-a-z0-9]*[a-z0-9])?$")


def _validate_k8s_name(name: str, *, max_len: int = 253) -> None:
    if len(name) > max_len:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="name too long")
    for part in name.split("."):
        if len(part) > 63 or not K8S_SEGMENT.match(part):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail=f"invalid name segment: {part!r}"
            )


def _data_dir() -> Path:
    return Path(get_settings().data_dir).resolve()


class SuggestionsRequest(BaseModel):
    namespace: str = Field(..., min_length=1)
    pod_name: str = Field(..., min_length=1)


class ExecuteRequest(BaseModel):
    action: Literal["delete_pod", "rollout_restart_deployment"]
    namespace: str
    pod_name: str | None = None
    deployment_name: str | None = None


def _kubectl_env(kubeconfig_path: str) -> dict[str, str]:
    env = os.environ.copy()
    env["KUBECONFIG"] = kubeconfig_path
    return env


@router.post("/suggestions", summary="Rule-based remediation ideas from pod state")
async def suggestions(
    body: SuggestionsRequest,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    _validate_k8s_name(body.namespace, max_len=63)
    _validate_k8s_name(body.pod_name, max_len=63)

    resolved = await resolve_active_kubeconfig(session, tenant_id, _data_dir())
    if resolved is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="No active cluster connection.",
        )
    path, ctx = resolved
    api = kubernetes_service.build_core_v1(path, ctx)
    try:
        pod = await asyncio.to_thread(
            kubernetes_service.read_pod_sync,
            api,
            body.namespace,
            body.pod_name,
        )
    except ApiException as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=e.reason or str(e)) from e

    items = suggestions_for_pod(pod)
    return {"pod": pod, "suggestions": items}


@router.post("/execute", summary="Run allow-listed kubectl (disabled unless REMEDIATION_ENABLED)")
async def execute(
    body: ExecuteRequest,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    settings = get_settings()
    if not settings.remediation_enabled:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Remediation execution disabled. Set EKS_ASSISTANT_REMEDIATION_ENABLED=true on the API server.",
        )

    kubectl = shutil.which("kubectl")
    if kubectl is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="kubectl not found on PATH in API container/host.",
        )

    resolved = await resolve_active_kubeconfig(session, tenant_id, _data_dir())
    if resolved is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="No active cluster connection.")

    path, _ctx = resolved
    env = _kubectl_env(path)

    _validate_k8s_name(body.namespace, max_len=63)

    if body.action == "delete_pod":
        if not body.pod_name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="pod_name required")
        _validate_k8s_name(body.pod_name, max_len=63)
        cmd = [kubectl, "delete", "pod", body.pod_name, "-n", body.namespace, "--wait=false"]
    else:
        if not body.deployment_name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="deployment_name required")
        _validate_k8s_name(body.deployment_name, max_len=63)
        cmd = [
            kubectl,
            "rollout",
            "restart",
            f"deployment/{body.deployment_name}",
            "-n",
            body.namespace,
        ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    out_b, err_b = await proc.communicate()
    stdout = out_b.decode(errors="replace").strip()
    stderr = err_b.decode(errors="replace").strip()
    exit_code = proc.returncode if proc.returncode is not None else -1

    audit = RemediationAudit(
        tenant_id=tenant_id,
        action_id=body.action,
        command_line=" ".join(cmd),
        exit_code=exit_code,
        stdout=stdout or None,
        stderr=stderr or None,
    )
    session.add(audit)
    await session.commit()

    if exit_code != 0:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail={"exit_code": exit_code, "stderr": stderr, "stdout": stdout},
        )

    return {"ok": True, "exit_code": exit_code, "stdout": stdout, "stderr": stderr}
