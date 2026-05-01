"""Resolve tenant kubeconfig paths and active connection."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from eks_assistant.db.models import ClusterConnection, TenantPreference


def safe_kubeconfig_path(data_dir: Path, relative: str) -> Path:
    base = data_dir.resolve()
    full = (base / relative).resolve()
    try:
        full.relative_to(base)
    except ValueError as e:
        raise ValueError("kubeconfig path escapes data directory") from e
    return full


async def get_active_connection(
    session: AsyncSession,
    tenant_id: str,
) -> ClusterConnection | None:
    pref = await session.get(TenantPreference, tenant_id)
    if not pref or not pref.active_connection_id:
        return None
    conn = await session.get(ClusterConnection, pref.active_connection_id)
    if conn is None or conn.tenant_id != tenant_id:
        return None
    return conn


async def resolve_active_kubeconfig(
    session: AsyncSession,
    tenant_id: str,
    data_dir: Path,
) -> tuple[str, str | None] | None:
    conn = await get_active_connection(session, tenant_id)
    if conn is None:
        return None
    path = safe_kubeconfig_path(data_dir, conn.kubeconfig_rel_path)
    if not path.is_file():
        return None
    return str(path), conn.context_name


async def list_connections(session: AsyncSession, tenant_id: str) -> list[ClusterConnection]:
    result = await session.scalars(
        select(ClusterConnection).where(ClusterConnection.tenant_id == tenant_id),
    )
    return list(result.all())
