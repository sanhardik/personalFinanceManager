"""
Shared test fixtures for the finance app backend.

Tests run against a real MariaDB instance (docker-compose.test.yml on port 3307).
Before running tests, start the test DB:
    ./run.sh test-db-up

The test database is created fresh for each test session:
- All tables are dropped and recreated before the test suite
- Default categories are seeded so category tests have data
- Each test gets its own DB session that rolls back on failure

If the test DB is unreachable, tests will fail immediately with a clear error.
"""

import os
import logging

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text
from sqlalchemy.pool import NullPool

from app.database import Base
from app.services.seed import seed_default_categories

# Import models so Base.metadata knows about all tables
import app.models  # noqa: F401

logger = logging.getLogger(__name__)

# ── Test database URL ────────────────────────────────────────
# Reads from .env.test or falls back to defaults for port 3307 test container
TEST_DB_HOST = os.getenv("TEST_DB_HOST", "localhost")
TEST_DB_PORT = os.getenv("TEST_DB_PORT", "3307")
TEST_DB_USER = os.getenv("TEST_DB_USER", "finance_test_user")
TEST_DB_PASSWORD = os.getenv("TEST_DB_PASSWORD", "finance_test_pass")
TEST_DB_NAME = os.getenv("TEST_DB_NAME", "finance_app_test")

TEST_DATABASE_URL = (
    f"mysql+aiomysql://{TEST_DB_USER}:{TEST_DB_PASSWORD}"
    f"@{TEST_DB_HOST}:{TEST_DB_PORT}/{TEST_DB_NAME}"
)


@pytest.fixture
def anyio_backend():
    """Use asyncio as the async backend for all tests."""
    return "asyncio"


@pytest.fixture(scope="session")
def test_engine():
    """
    Create an async SQLAlchemy engine connected to the test MariaDB.
    Shared across the entire test session for efficiency.
    """
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        poolclass=NullPool,
    )
    return engine


@pytest.fixture(scope="session")
def test_session_factory(test_engine):
    """Session factory bound to the test engine."""
    return async_sessionmaker(
        test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


@pytest.fixture(scope="session")
async def setup_test_database(test_engine):
    """
    Session-scoped fixture: drop all tables, recreate them, seed defaults.
    Runs once at the start of the entire test suite.
    """
    try:
        # Verify connectivity first
        async with test_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as e:
        pytest.exit(
            f"\n\n"
            f"  ╔══════════════════════════════════════════════════════════╗\n"
            f"  ║  TEST DATABASE NOT REACHABLE                            ║\n"
            f"  ║                                                          ║\n"
            f"  ║  Start it with:  ./run.sh test-db-up                    ║\n"
            f"  ║  Connection:     {TEST_DB_HOST}:{TEST_DB_PORT}/{TEST_DB_NAME}    ║\n"
            f"  ║  Error: {str(e)[:45]:<45s} ║\n"
            f"  ╚══════════════════════════════════════════════════════════╝\n",
            returncode=1,
        )

    # Drop and recreate all tables for a clean slate
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    # Seed default categories
    session_factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        count = await seed_default_categories(session)
        logger.info("Test DB seeded with %d categories", count)

    yield

    # Cleanup: drop all tables after all tests complete
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()


@pytest.fixture
async def db_session(test_session_factory):
    """
    Per-test DB session. Uses a savepoint so each test is isolated:
    changes within a test are rolled back after the test completes.
    """
    async with test_session_factory() as session:
        yield session
        # Roll back any uncommitted changes from this test
        await session.rollback()


@pytest.fixture(autouse=True)
async def truncate_data(test_session_factory, setup_test_database):
    """Truncate transactions, accounts, rules, and suggested_rules before each test."""
    async with test_session_factory() as session:
        await session.execute(text("DELETE FROM suggested_rules"))
        await session.execute(text("DELETE FROM stock_valuations"))
        await session.execute(text("DELETE FROM stock_trades"))
        await session.execute(text("DELETE FROM transactions"))
        await session.execute(text("DELETE FROM accounts"))
        await session.execute(text("DELETE FROM rules"))
        await session.commit()
    yield


class _ApiClient:
    """
    Thin wrapper around AsyncClient that prepends /api to every request path.

    All routers are mounted under /api in main.py so that the built frontend
    (served by FastAPI in production) and the dev Vite proxy both work correctly.
    Tests hit FastAPI directly via ASGI, so they need the /api prefix too.
    """

    def __init__(self, client: AsyncClient):
        self._c = client

    def _url(self, path: str) -> str:
        return f"/api{path}"

    async def get(self, url, **kw):
        return await self._c.get(self._url(url), **kw)

    async def post(self, url, **kw):
        return await self._c.post(self._url(url), **kw)

    async def put(self, url, **kw):
        return await self._c.put(self._url(url), **kw)

    async def patch(self, url, **kw):
        return await self._c.patch(self._url(url), **kw)

    async def delete(self, url, **kw):
        return await self._c.delete(self._url(url), **kw)


@pytest.fixture
async def client(test_session_factory, setup_test_database):
    """
    Async HTTP test client connected to the real test MariaDB.

    Overrides the app's get_db dependency so all routes use the test DB.
    The lifespan event is handled by setup_test_database fixture.
    """
    from app.database import get_db
    from app.main import app

    async def override_get_db():
        async with test_session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield _ApiClient(ac)

    app.dependency_overrides.clear()
