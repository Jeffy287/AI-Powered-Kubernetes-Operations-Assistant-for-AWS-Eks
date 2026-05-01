"""Upload kubeconfig per tenant and activate cluster context (org-local multi-tenant)."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from eks_assistant.api.deps import DbSessionDep, TenantIdDep
from eks_assistant.api.schemas.connection_bootstrap import (
    TokenKubeconfigRequest,
    render_kubeconfig_token_auth,
)
from eks_assistant.core.config import get_settings
from eks_assistant.db.models import ClusterConnection, TenantPreference
from eks_assistant.services import kubernetes_service
from eks_assistant.services.cluster_context import (
    get_active_connection,
    list_connections,
    safe_kubeconfig_path,
)

router = APIRouter(prefix="/connections", tags=["connections"])

MAX_KUBECONFIG_BYTES = 512 * 1024


def _data_dir() -> Path:
    return Path(get_settings().data_dir).resolve()


@router.get("", summary="List saved connections for this tenant")
async def list_all(session: DbSessionDep, tenant_id: TenantIdDep) -> dict:
    rows = await list_connections(session, tenant_id)
    active = await get_active_connection(session, tenant_id)
    active_id = active.id if active else None
    return {
        "tenant_id": tenant_id,
        "active_connection_id": active_id,
        "connections": [
            {
                "id": r.id,
                "display_name": r.display_name,
                "context_name": r.context_name,
                "created_at": r.created_at.isoformat(),
                "last_test_ok_at": r.last_test_ok_at.isoformat() if r.last_test_ok_at else None,
                "last_test_message": r.last_test_message,
            }
            for r in rows
        ],
    }


@router.post(
    "",
    summary="Wizard: upload kubeconfig and register connection",
    status_code=status.HTTP_201_CREATED,
)
async def create_connection(
    session: DbSessionDep,
    tenant_id: TenantIdDep,
    display_name: str = Form(..., min_length=1, max_length=256),
    context_name: str | None = Form(None),
    kubeconfig: UploadFile = File(...),
) -> dict:
    raw = await kubeconfig.read()
    if len(raw) > MAX_KUBECONFIG_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="kubeconfig file too large",
        )
    text = raw.decode("utf-8", errors="strict")
    if "apiVersion:" not in text or "kind:" not in text:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="file does not look like a kubeconfig",
        )

    conn_id = str(uuid.uuid4())
    rel = f"kubeconfigs/{conn_id}/config"
    data = _data_dir()
    dest = data / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)

    ctx = context_name.strip() if context_name and context_name.strip() else None
    row = ClusterConnection(
        id=conn_id,
        tenant_id=tenant_id,
        display_name=display_name.strip(),
        kubeconfig_rel_path=rel,
        context_name=ctx,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)

    return {
        "id": row.id,
        "display_name": row.display_name,
        "context_name": row.context_name,
        "message": "Connection saved. Activate it and run Test to validate credentials.",
    }


@router.post(
    "/bootstrap-token",
    summary="Create connection from API URL + CA + bearer token (JSON body)",
    status_code=status.HTTP_201_CREATED,
)
async def bootstrap_token(
    body: TokenKubeconfigRequest,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    text = render_kubeconfig_token_auth(body)
    raw = text.encode("utf-8")
    if len(raw) > MAX_KUBECONFIG_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="generated kubeconfig too large",
        )

    conn_id = str(uuid.uuid4())
    rel = f"kubeconfigs/{conn_id}/config"
    data = _data_dir()
    dest = data / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)

    ctx_name = body.context_name.strip()
    row = ClusterConnection(
        id=conn_id,
        tenant_id=tenant_id,
        display_name=body.display_name.strip(),
        kubeconfig_rel_path=rel,
        context_name=ctx_name,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)

    return {
        "id": row.id,
        "display_name": row.display_name,
        "context_name": row.context_name,
        "message": "Connection saved from token. Activate and test.",
    }


@router.post("/{connection_id}/activate", summary="Set active connection for tenant")
async def activate(
    connection_id: str,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    conn = await session.get(ClusterConnection, connection_id)
    if conn is None or conn.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="connection not found")

    pref = await session.get(TenantPreference, tenant_id)
    if pref is None:
        pref = TenantPreference(tenant_id=tenant_id)
        session.add(pref)
    pref.active_connection_id = connection_id
    await session.commit()
    return {"active_connection_id": connection_id}


@router.post("/{connection_id}/test", summary="Validate kubeconfig (lists namespaces)")
async def test_connection(
    connection_id: str,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    conn = await session.get(ClusterConnection, connection_id)
    if conn is None or conn.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="connection not found")

    path = safe_kubeconfig_path(_data_dir(), conn.kubeconfig_rel_path)
    if not path.is_file():
        conn.last_test_ok_at = None
        conn.last_test_message = "kubeconfig file missing on disk"
        await session.commit()
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="kubeconfig file missing",
        )

    try:
        api = kubernetes_service.build_core_v1(str(path), conn.context_name)
        namespaces = await asyncio.to_thread(kubernetes_service.list_namespaces_sync, api)
        ver = await asyncio.to_thread(
            kubernetes_service.version_info,
            str(path),
            conn.context_name,
        )
    except Exception as e:
        conn.last_test_ok_at = None
        conn.last_test_message = str(e)
        await session.commit()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Kubernetes API error: {e}",
        ) from e

    conn.last_test_ok_at = datetime.now(UTC)
    conn.last_test_message = "ok"
    await session.commit()

    return {
        "ok": True,
        "namespace_count": len(namespaces),
        "kubernetes_version": ver,
    }


@router.delete("/{connection_id}", summary="Remove connection and kubeconfig file")
async def delete_connection(
    connection_id: str,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    conn = await session.get(ClusterConnection, connection_id)
    if conn is None or conn.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="connection not found")

    path = safe_kubeconfig_path(_data_dir(), conn.kubeconfig_rel_path)
    if path.is_file():
        path.unlink()

    pref = await session.get(TenantPreference, tenant_id)
    if pref and pref.active_connection_id == connection_id:
        pref.active_connection_id = None

    await session.delete(conn)
    await session.commit()
    return {"deleted": connection_id}
