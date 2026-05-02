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
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

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
from app.routers.assets import router as assets_router
from app.routers.auth import router as auth_router
from app.routers.categories import router as categories_router
from app.routers.dashboard import router as dashboard_router
from app.routers.investments import router as investments_router
from app.routers.loans import router as loans_router
from app.routers.networth import router as networth_router
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
    # Startup — ensure all ORM tables exist
    await create_tables()

    # Schema migrations — MariaDB only (SQLite gets the full schema from create_all)
    if not settings.is_sqlite:
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

        # Schema migrations — add investment value columns + BSB to accounts
        try:
            async with engine.begin() as conn:
                for col_name, col_def in [
                    ("current_value", "DECIMAL(12,2) NULL"),
                    ("current_value_at", "DATETIME NULL"),
                    ("bsb", "VARCHAR(10) NULL"),
                ]:
                    exists = await conn.execute(text(
                        "SELECT COUNT(*) FROM information_schema.COLUMNS "
                        "WHERE TABLE_SCHEMA = DATABASE() "
                        "AND TABLE_NAME = 'accounts' AND COLUMN_NAME = :col"
                    ), {"col": col_name})
                    if exists.scalar() == 0:
                        await conn.execute(text(
                            f"ALTER TABLE accounts ADD COLUMN {col_name} {col_def}"
                        ))
                        logger.info("Migration: added %s to accounts", col_name)
        except Exception as e:
            logger.warning("Migration check failed (non-fatal): %s", e)

        # Schema migrations — add loan fields to accounts
        try:
            async with engine.begin() as conn:
                for col_name, col_def in [
                    ("asset_id", "INT NULL"),
                    ("loan_original_amount", "DECIMAL(12,2) NULL"),
                    ("loan_interest_rate", "DECIMAL(6,4) NULL"),
                    ("loan_start_date", "DATETIME NULL"),
                    ("loan_term_years", "INT NULL"),
                    ("loan_repayment_type", "VARCHAR(30) NULL"),
                    ("offset_account_id", "INT NULL"),
                ]:
                    exists = await conn.execute(text(
                        "SELECT COUNT(*) FROM information_schema.COLUMNS "
                        "WHERE TABLE_SCHEMA = DATABASE() "
                        "AND TABLE_NAME = 'accounts' AND COLUMN_NAME = :col"
                    ), {"col": col_name})
                    if exists.scalar() == 0:
                        await conn.execute(text(
                            f"ALTER TABLE accounts ADD COLUMN {col_name} {col_def}"
                        ))
                        logger.info("Migration: added %s to accounts", col_name)
        except Exception as e:
            logger.warning("Migration: loan fields check failed (non-fatal): %s", e)

        # Schema migrations — add transfer_account_id to rules + suggested_rules
        try:
            async with engine.begin() as conn:
                for table in ("rules", "suggested_rules"):
                    exists = await conn.execute(text(
                        "SELECT COUNT(*) FROM information_schema.COLUMNS "
                        "WHERE TABLE_SCHEMA = DATABASE() "
                        "AND TABLE_NAME = :tbl AND COLUMN_NAME = 'transfer_account_id'"
                    ), {"tbl": table})
                    if exists.scalar() == 0:
                        await conn.execute(text(
                            f"ALTER TABLE {table} ADD COLUMN transfer_account_id INT NULL"
                        ))
                        logger.info("Migration: added transfer_account_id to %s", table)
        except Exception as e:
            logger.warning("Migration: transfer_account_id on rules failed (non-fatal): %s", e)

        # Schema migration — fix suggested_rules.promoted_rule_id FK to ON DELETE SET NULL
        try:
            async with engine.begin() as conn:
                # Check current DELETE_RULE for the FK on promoted_rule_id
                result = await conn.execute(text(
                    "SELECT rc.CONSTRAINT_NAME, rc.DELETE_RULE "
                    "FROM information_schema.REFERENTIAL_CONSTRAINTS rc "
                    "JOIN information_schema.KEY_COLUMN_USAGE kcu "
                    "  ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME "
                    "  AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA "
                    "WHERE kcu.TABLE_SCHEMA = DATABASE() "
                    "AND kcu.TABLE_NAME = 'suggested_rules' "
                    "AND kcu.COLUMN_NAME = 'promoted_rule_id'"
                ))
                row = result.fetchone()
                if row and row[1] != "SET NULL":
                    fk_name = row[0]
                    await conn.execute(text(
                        f"ALTER TABLE suggested_rules DROP FOREIGN KEY `{fk_name}`"
                    ))
                    await conn.execute(text(
                        "ALTER TABLE suggested_rules ADD CONSTRAINT `fk_suggested_rules_promoted_rule` "
                        "FOREIGN KEY (promoted_rule_id) REFERENCES rules(id) ON DELETE SET NULL"
                    ))
                    logger.info("Migration: fixed promoted_rule_id FK to ON DELETE SET NULL")
        except Exception as e:
            logger.warning("Migration: promoted_rule_id FK fix failed (non-fatal): %s", e)

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
app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(assets_router)
app.include_router(categories_router)
app.include_router(dashboard_router)
app.include_router(investments_router)
app.include_router(loans_router)
app.include_router(networth_router)
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


# ── Serve built React frontend (production mode) ──────────────
# In dev mode the Vite server handles the frontend on port 5173.
# When the frontend has been built (npm run build), FastAPI serves
# the static files so the whole app is accessible on a single port.
_FRONTEND_DIST = Path(__file__).parent.parent.parent / "frontend" / "dist"

if _FRONTEND_DIST.is_dir():
    # Serve the Vite assets bundle (/assets/*)
    app.mount(
        "/assets",
        StaticFiles(directory=str(_FRONTEND_DIST / "assets")),
        name="frontend-assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        """Serve the React SPA — catch-all for client-side routes."""
        file = _FRONTEND_DIST / full_path
        if file.is_file():
            return FileResponse(str(file))
        return FileResponse(str(_FRONTEND_DIST / "index.html"))
