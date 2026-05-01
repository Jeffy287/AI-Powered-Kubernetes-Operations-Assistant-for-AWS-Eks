from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from eks_assistant.db.models import Base

_engine = None
session_factory: async_sessionmaker[AsyncSession] | None = None


def database_url_for_path(db_path: Path) -> str:
    return f"sqlite+aiosqlite:///{db_path.resolve().as_posix()}"


def _create_engine(db_path: Path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return create_async_engine(
        database_url_for_path(db_path),
        echo=False,
    )


async def init_db(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def init_database(data_dir: Path) -> None:
    global _engine, session_factory
    data_dir.mkdir(parents=True, exist_ok=True)
    _engine = _create_engine(data_dir / "app.db")
    await init_db(_engine)
    session_factory = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


async def shutdown_database() -> None:
    global _engine, session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    session_factory = None


async def get_db() -> AsyncIterator[AsyncSession]:
    if session_factory is None:
        raise RuntimeError("Database not initialized")
    async with session_factory() as session:
        yield session
