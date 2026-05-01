"""Amazon Bedrock powered explanations for cluster context."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from kubernetes.client.rest import ApiException

from eks_assistant.api.deps import DbSessionDep, TenantIdDep
from eks_assistant.api.schemas.assistant import ExplainRequest, ExplainResponse
from eks_assistant.core.config import get_settings
from eks_assistant.services import kubernetes_service
from eks_assistant.services.bedrock_client import run_bedrock_converse
from eks_assistant.services.cluster_context import resolve_active_kubeconfig

router = APIRouter(prefix="/assistant", tags=["assistant"])

_SYSTEM_PROMPT = """You are a senior Kubernetes and AWS EKS site reliability engineer.
You receive structured JSON from describe-like API reads (pods, nodes) plus optional logs or notes.
Explain clearly for an engineer: what likely matters, risks, and next checks.
Suggest kubectl commands when helpful; prefix destructive actions with warnings.
Be concise but actionable; use short sections and bullets when appropriate."""


def _data_dir() -> Path:
    return Path(get_settings().data_dir).resolve()


async def _core_api(session, tenant_id: str):
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


def _raise_from_api_exception(exc: ApiException) -> None:
    code = int(exc.status) if exc.status else 502
    if code == 404:
        http_status = status.HTTP_404_NOT_FOUND
    elif code == 403:
        http_status = status.HTTP_403_FORBIDDEN
    elif code == 401:
        http_status = status.HTTP_401_UNAUTHORIZED
    else:
        http_status = status.HTTP_502_BAD_GATEWAY
    raise HTTPException(http_status, detail=str(exc.reason or exc)) from exc


@router.get("/bedrock/status", summary="Whether Bedrock explain is configured")
async def bedrock_status() -> dict:
    s = get_settings()
    return {
        "enabled": bool(s.bedrock_model_id and s.bedrock_model_id.strip()),
        "region": s.bedrock_region,
    }


@router.post("/explain", summary="Explain pod/node context via Amazon Bedrock")
async def explain_cluster(
    body: ExplainRequest,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> ExplainResponse:
    settings = get_settings()
    model_id = (settings.bedrock_model_id or "").strip()
    if not model_id:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Bedrock is not configured. Set EKS_ASSISTANT_BEDROCK_MODEL_ID "
                "(inference profile id from the Bedrock console) and ensure AWS credentials "
                "or task role can call bedrock-runtime:InvokeModel / converse."
            ),
        )

    chunks: list[str] = []
    chunks.append(f"Workspace tenant id (header X-Tenant-ID): {tenant_id}")

    need_cluster = body.pod is not None or (body.node_name and body.node_name.strip())
    if need_cluster:
        api, _, _ = await _core_api(session, tenant_id)

    if body.pod:
        try:
            detail = await asyncio.to_thread(
                kubernetes_service.read_pod_sync,
                api,
                body.pod.namespace,
                body.pod.name,
            )
        except ApiException as e:
            _raise_from_api_exception(e)
        chunks.append("## Pod (from cluster)\n```json\n")
        chunks.append(json.dumps(detail, indent=2)[:120000])
        chunks.append("\n```")

    if body.node_name and body.node_name.strip():
        nn = body.node_name.strip()
        try:
            nd = await asyncio.to_thread(kubernetes_service.read_node_sync, api, nn)
        except ApiException as e:
            _raise_from_api_exception(e)
        chunks.append("\n## Node (from cluster)\n```json\n")
        chunks.append(json.dumps(nd, indent=2)[:120000])
        chunks.append("\n```")

    if body.extra_context and body.extra_context.strip():
        chunks.append("\n## Additional context (user-supplied)\n")
        chunks.append(body.extra_context.strip()[:48000])

    user_blob = "\n".join(chunks)
    if body.question and body.question.strip():
        user_blob = (
            f"User question:\n{body.question.strip()}\n\n---\n\nContext:\n{user_blob}"
        )

    try:
        explanation = await asyncio.to_thread(
            run_bedrock_converse,
            region=settings.bedrock_region,
            model_id=model_id,
            system_prompt=_SYSTEM_PROMPT,
            user_text=user_blob,
            max_tokens=4096,
        )
    except RuntimeError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Bedrock request failed: {e}",
        ) from e

    return ExplainResponse(explanation=explanation, model_id=model_id)
