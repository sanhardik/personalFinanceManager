"""
FastAPI application entry point for Personal Finance Manager.

This is the main app module that:
- Initialises the FastAPI application with lifespan events
- Configures CORS for the React frontend (localhost:5173)
- Registers the /health endpoint for monitoring
- Registers routers for categories (Chunk 2), transactions (Chunk 3+), etc.
- Seeds default categories on first startup

Run with: uvicorn app.main:app --reload --port 8000
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from sqlalchemy import text

from app.database import (
    async_session_factory,
    check_db_connection,
    create_tables,
    dispose_engine,
    engine,
)

# Import models so SQLAlchemy knows about them before create_tables()
import app.models  # noqa: F401

from app.routers.accounts import router as accounts_router
from app.routers.categories import router as categories_router
from app.routers.rules import router as rules_router
from app.routers.transactions import router as transactions_router
from app.routers.upload import router as upload_router
from app.services.seed import seed_default_categories, seed_default_rules

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifecycle events.

    Startup: Create database tables if they don't exist, then seed defaults.
    Shutdown: Dispose of the SQLAlchemy engine and close all DB connections.
    """
    # Startup — ensure all ORM tables exist in MariaDB
    await create_tables()

    # Schema migrations — add columns that create_all can't add to existing tables
    try:
        async with engine.begin() as conn:
            exists = await conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = 'transactions' "
                "AND COLUMN_NAME = 'transfer_account_id'"
            ))
            if exists.scalar() == 0:
                await conn.execute(text(
                    "ALTER TABLE transactions ADD COLUMN transfer_account_id INT NULL"
                ))
                logger.info("Migration: added transfer_account_id to transactions")
    except Exception as e:
        logger.warning("Migration check failed (non-fatal): %s", e)

    # Seed default categories + rules (idempotent — skips existing)
    try:
        async with async_session_factory() as session:
            await seed_default_categories(session)
        async with async_session_factory() as session:
            await seed_default_rules(session)
    except Exception as e:
        logger.warning("Could not seed defaults (DB might be unavailable): %s", e)

    yield
    # Shutdown — cleanly release the connection pool
    await dispose_engine()


# Initialise the FastAPI app with metadata and lifespan handler
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

# CORS middleware — allows the React frontend (Vite dev server) to call the API.
# In production, restrict allow_origins to the actual frontend domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register routers ─────────────────────────────────────────
app.include_router(accounts_router)
app.include_router(categories_router)
app.include_router(rules_router)
app.include_router(transactions_router)
app.include_router(upload_router)


@app.get("/health")
async def health_check():
    """
    Health check endpoint.

    Returns the API status, database connectivity, and app version.
    Used by the React frontend header badge and monitoring tools.

    Returns:
        - status: "ok" if DB is reachable, "degraded" if not
        - database: "connected" or "disconnected"
        - version: current app version from settings
    """
    db_ok = await check_db_connection()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "disconnected",
        "version": settings.APP_VERSION,
    }
