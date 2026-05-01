"""Persistent incident memory + keyword search (lightweight RAG-style recall)."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from eks_assistant.api.deps import DbSessionDep, TenantIdDep
from eks_assistant.db.models import Incident

router = APIRouter(prefix="/incidents", tags=["incidents"])


class IncidentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=512)
    body: str = Field(..., min_length=1)
    source_json: dict[str, Any] | None = None


class IncidentFromAnalysis(BaseModel):
    """Save last analysis JSON with auto-generated title."""

    analysis: dict[str, Any] | list[Any]
    note: str | None = Field(None, max_length=2000)


@router.post("", summary="Store an incident / analysis snapshot")
async def create_incident(
    body: IncidentCreate,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    src = json.dumps(body.source_json) if body.source_json is not None else None
    row = Incident(
        tenant_id=tenant_id,
        title=body.title.strip(),
        body=body.body.strip(),
        source_json=src,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {"id": row.id, "title": row.title}


@router.post("/from-analysis", summary="Persist K8sGPT-style JSON as searchable memory")
async def from_analysis(
    payload: IncidentFromAnalysis,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    blob = json.dumps(payload.analysis, indent=2)[:40000]
    title = "Cluster analysis snapshot"
    if payload.note:
        title = f"{title}: {payload.note[:200]}"
    row = Incident(
        tenant_id=tenant_id,
        title=title,
        body=blob,
        source_json=blob,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {"id": row.id, "title": row.title}


@router.get("", summary="Recent incidents for tenant")
async def recent(
    session: DbSessionDep,
    tenant_id: TenantIdDep,
    limit: int = Query(30, ge=1, le=200),
) -> dict:
    result = await session.scalars(
        select(Incident)
        .where(Incident.tenant_id == tenant_id)
        .order_by(Incident.created_at.desc())
        .limit(limit),
    )
    rows = result.all()
    return {
        "items": [
            {
                "id": r.id,
                "title": r.title,
                "created_at": r.created_at.isoformat(),
                "preview": r.body[:240] + ("…" if len(r.body) > 240 else ""),
            }
            for r in rows
        ],
    }


@router.get("/search", summary="Keyword memory search (FTS-style recall without vectors)")
async def search(
    session: DbSessionDep,
    tenant_id: TenantIdDep,
    q: str = Query(..., min_length=2, max_length=500),
    limit: int = Query(15, ge=1, le=50),
) -> dict:
    words = [w.strip() for w in q.split() if len(w.strip()) > 1]
    if not words:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="query too short")

    clauses = []
    for w in words:
        like = f"%{w}%"
        clauses.append(or_(Incident.title.like(like), Incident.body.like(like)))

    stmt = (
        select(Incident)
        .where(Incident.tenant_id == tenant_id)
        .where(or_(*clauses))
        .order_by(Incident.created_at.desc())
        .limit(limit)
    )
    result = await session.scalars(stmt)
    rows = result.all()
    return {
        "query": q,
        "items": [
            {
                "id": r.id,
                "title": r.title,
                "created_at": r.created_at.isoformat(),
                "snippet": r.body[:400] + ("…" if len(r.body) > 400 else ""),
            }
            for r in rows
        ],
    }


@router.get("/{incident_id}", summary="Fetch full incident")
async def get_one(
    incident_id: int,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    row = await session.get(Incident, incident_id)
    if row is None or row.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not found")
    return {
        "id": row.id,
        "title": row.title,
        "body": row.body,
        "source_json": row.source_json,
        "created_at": row.created_at.isoformat(),
    }


@router.delete("/{incident_id}", summary="Delete incident")
async def remove(
    incident_id: int,
    session: DbSessionDep,
    tenant_id: TenantIdDep,
) -> dict:
    row = await session.get(Incident, incident_id)
    if row is None or row.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not found")
    await session.delete(row)
    await session.commit()
    return {"deleted": incident_id}
