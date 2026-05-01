"""Delete all persisted data for a tenant/workspace."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from eks_assistant.db.models import (
    ClusterConnection,
    Incident,
    RemediationAudit,
    TenantPreference,
    Workspace,
)
from eks_assistant.services.cluster_context import safe_kubeconfig_path


async def purge_workspace(session: AsyncSession, tenant_id: str, data_dir: Path) -> dict[str, int]:
    """Remove connections (and kubeconfig files), incidents, audits, preferences, workspace row."""
    root = data_dir.resolve()
    result = await session.execute(
        select(ClusterConnection).where(ClusterConnection.tenant_id == tenant_id),
    )
    conn_rows = result.scalars().all()
    files_removed = 0
    for conn in conn_rows:
        path = safe_kubeconfig_path(root, conn.kubeconfig_rel_path)
        if path.is_file():
            path.unlink()
            files_removed += 1

    await session.execute(delete(ClusterConnection).where(ClusterConnection.tenant_id == tenant_id))
    await session.execute(delete(Incident).where(Incident.tenant_id == tenant_id))
    await session.execute(delete(RemediationAudit).where(RemediationAudit.tenant_id == tenant_id))
    await session.execute(delete(TenantPreference).where(TenantPreference.tenant_id == tenant_id))
    await session.execute(delete(Workspace).where(Workspace.id == tenant_id))

    await session.commit()
    return {
        "connections_removed": len(conn_rows),
        "kubeconfig_files_removed": files_removed,
    }
