from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from eks_assistant.db.session import get_db


async def tenant_id_header(x_tenant_id: str | None = Header(None, alias="X-Tenant-ID")) -> str:
    tid = (x_tenant_id or "default").strip()
    return tid or "default"


TenantIdDep = Annotated[str, Depends(tenant_id_header)]
DbSessionDep = Annotated[AsyncSession, Depends(get_db)]
