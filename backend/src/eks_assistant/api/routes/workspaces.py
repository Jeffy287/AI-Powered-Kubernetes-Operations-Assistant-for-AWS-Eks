"""Register and manage workspaces (tenant ids); purge all data on delete."""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from eks_assistant.api.deps import DbSessionDep
from eks_assistant.core.config import get_settings
from eks_assistant.db.models import (
    ClusterConnection,
    Incident,
    TenantPreference,
    Workspace,
)
from eks_assistant.services.workspace_purge import purge_workspace

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

_WS_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")


class WorkspaceCreate(BaseModel):
    id: str = Field(..., min_length=1, max_length=128)

    @field_validator("id")
    @classmethod
    def validate_id(cls, v: str) -> str:
        s = v.strip()
        if not _WS_ID.match(s):
            raise ValueError(
                "workspace id: alphanumeric start, then letters, digits, . _ - (max 128 chars)",
            )
        return s


def _data_dir():
    from pathlib import Path

    return Path(get_settings().data_dir).resolve()


@router.get("", summary="List workspace ids known to the server")
async def list_workspaces(session: DbSessionDep) -> dict[str, Any]:
    """Merges explicit workspaces and any tenant_id seen in connections, incidents, or preferences."""
    ids: set[str] = set()
    for row in (await session.execute(select(Workspace.id))).all():
        ids.add(row[0])
    for row in (await session.execute(select(ClusterConnection.tenant_id).distinct())).all():
        ids.add(row[0])
    for row in (await session.execute(select(Incident.tenant_id).distinct())).all():
        ids.add(row[0])
    for row in (await session.execute(select(TenantPreference.tenant_id))).all():
        ids.add(row[0])
    sorted_ids = sorted(ids)
    return {"items": [{"id": x} for x in sorted_ids]}


@router.post("", summary="Register an empty workspace id", status_code=status.HTTP_201_CREATED)
async def create_workspace(session: DbSessionDep, body: WorkspaceCreate) -> dict[str, Any]:
    wid = body.id
    existing = await session.get(Workspace, wid)
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="workspace already exists")
    session.add(Workspace(id=wid))
    await session.commit()
    return {"id": wid}


@router.delete("/{workspace_id}", summary="Delete workspace and all tenant-scoped data")
async def delete_workspace(workspace_id: str, session: DbSessionDep) -> dict[str, Any]:
    if not _WS_ID.match(workspace_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="invalid workspace id")
    stats = await purge_workspace(session, workspace_id, _data_dir())
    return {"deleted": workspace_id, **stats}


@router.get("/{workspace_id}/stats", summary="Counts for a workspace (optional)")
async def workspace_stats(workspace_id: str, session: DbSessionDep) -> dict[str, Any]:
    if not _WS_ID.match(workspace_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="invalid workspace id")
    n_conn = (
        await session.execute(
            select(func.count()).select_from(ClusterConnection).where(
                ClusterConnection.tenant_id == workspace_id,
            ),
        )
    ).scalar_one()
    n_inc = (
        await session.execute(
            select(func.count()).select_from(Incident).where(Incident.tenant_id == workspace_id),
        )
    ).scalar_one()
    pref = await session.get(TenantPreference, workspace_id)
    return {
        "id": workspace_id,
        "connections": int(n_conn or 0),
        "incidents": int(n_inc or 0),
        "active_connection_id": pref.active_connection_id if pref else None,
    }
