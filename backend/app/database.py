"""
Async SQLAlchemy database setup for MariaDB via aiomysql.

This module provides:
- An async SQLAlchemy engine connected to MariaDB
- A session factory for creating async DB sessions
- FastAPI dependency (get_db) for injecting sessions into routes
- Utility functions for health checks, table creation, and cleanup

Connection string is built from settings in app/config.py.
"""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text

from app.config import settings

# Async engine — manages a connection pool to MariaDB.
# pool_recycle=3600 prevents stale connections after MariaDB's wait_timeout.
engine = create_async_engine(
    settings.database_url,
    echo=settings.DEBUG,       # Log SQL queries when DEBUG=True
    pool_size=10,              # Max persistent connections in the pool
    max_overflow=20,           # Additional connections allowed beyond pool_size
    pool_recycle=3600,         # Recycle connections after 1 hour
)

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
