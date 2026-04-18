"""
Async SQLAlchemy database setup — supports MariaDB and SQLite.

This module provides:
- An async SQLAlchemy engine (MariaDB via aiomysql, or SQLite via aiosqlite)
- A session factory for creating async DB sessions
- FastAPI dependency (get_db) for injecting sessions into routes
- Utility functions for health checks, table creation, and cleanup
"""

from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event, text
from sqlalchemy.pool import NullPool

from app.config import settings


def _create_engine():
    if settings.is_sqlite:
        # Ensure the parent directory exists before SQLite creates the file
        db_path = Path(settings.SQLITE_PATH)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        eng = create_async_engine(
            settings.database_url,
            echo=settings.DEBUG,
            poolclass=NullPool,
        )

        # Enable foreign key enforcement per connection (SQLite default is off)
        @event.listens_for(eng.sync_engine, "connect")
        def set_sqlite_pragma(dbapi_conn, _connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return eng
    else:
        return create_async_engine(
            settings.database_url,
            echo=settings.DEBUG,
            pool_size=10,
            max_overflow=20,
            pool_recycle=3600,
        )


# Async engine — manages DB connections (MariaDB pool or SQLite NullPool)
engine = _create_engine()

# Session factory — creates new AsyncSession instances.
# expire_on_commit=False keeps objects usable after commit without re-querying.
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# Base class for all models
class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency — yields an async DB session."""
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()


async def check_db_connection() -> bool:
    """Test the database connection. Returns True if healthy."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def create_tables():
    """Create all tables defined in models (import models before calling)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def dispose_engine():
    """Cleanly shut down the engine connection pool."""
    await engine.dispose()
