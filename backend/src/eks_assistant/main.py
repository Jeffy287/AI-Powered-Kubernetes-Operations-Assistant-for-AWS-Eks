from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from eks_assistant.api.routes import (
    assistant,
    cluster,
    connections,
    diagnostics,
    health,
    incidents,
    k8sgpt,
    remediation,
    workspaces,
)
from eks_assistant.core.config import get_settings
from eks_assistant.db.session import init_database, shutdown_database


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await init_database(Path(settings.data_dir).resolve())
        yield
        await shutdown_database()

    app = FastAPI(
        title="EKS Operations Assistant API",
        description="Diagnostics, native Kubernetes reads, incident memory, and remediation helpers.",
        version="0.2.0",
        lifespan=lifespan,
        openapi_url=f"{settings.api_prefix}/openapi.json",
        docs_url=f"{settings.api_prefix}/docs",
        redoc_url=f"{settings.api_prefix}/redoc",
    )

    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix=settings.api_prefix)
    app.include_router(workspaces.router, prefix=settings.api_prefix)
    app.include_router(connections.router, prefix=settings.api_prefix)
    app.include_router(assistant.router, prefix=settings.api_prefix)
    app.include_router(cluster.router, prefix=settings.api_prefix)
    app.include_router(diagnostics.router, prefix=settings.api_prefix)
    app.include_router(k8sgpt.router, prefix=settings.api_prefix)
    app.include_router(incidents.router, prefix=settings.api_prefix)
    app.include_router(remediation.router, prefix=settings.api_prefix)

    return app


app = create_app()
