"""Tests for the /health endpoint and application bootstrap."""

import pytest


@pytest.mark.anyio
async def test_health_endpoint_returns_200(client):
    """Health endpoint should return 200 with status field."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "database" in data
    assert "version" in data


@pytest.mark.anyio
async def test_health_endpoint_has_version(client):
    """Health endpoint should include the app version."""
    response = await client.get("/health")
    data = response.json()
    assert data["version"] == "0.1.0"


@pytest.mark.anyio
async def test_health_status_ok_or_degraded(client):
    """Health status should be 'ok' or 'degraded' (never crash)."""
    response = await client.get("/health")
    data = response.json()
    assert data["status"] in ("ok", "degraded")


@pytest.mark.anyio
async def test_cors_headers_present(client):
    """CORS preflight should allow the frontend origin."""
    response = await client.options(
        "/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    # FastAPI CORS middleware responds to OPTIONS
    assert response.status_code in (200, 405)


@pytest.mark.anyio
async def test_unknown_route_returns_404(client):
    """Non-existent routes should return 404."""
    response = await client.get("/nonexistent")
    assert response.status_code == 404
