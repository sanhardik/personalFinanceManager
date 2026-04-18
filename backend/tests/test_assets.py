"""
Tests for the /assets endpoints.

Covers: CRUD operations, type validation, delete protection.
"""

import pytest
from httpx import AsyncClient


# ── Helpers ───────────────────────────────────────────────────

async def _create_asset(client, **kwargs):
    payload = {"asset_name": "Test Property", "asset_type": "property", **kwargs}
    r = await client.post("/assets", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


# ── List ──────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_list_assets_empty(client: AsyncClient):
    """GET /assets returns empty list when no assets exist."""
    r = await client.get("/assets")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.anyio
async def test_list_assets_returns_all(client: AsyncClient):
    """GET /assets returns all created assets."""
    await _create_asset(client, asset_name="Boondall")
    await _create_asset(client, asset_name="Bigg Street")
    r = await client.get("/assets")
    assert r.status_code == 200
    names = [a["asset_name"] for a in r.json()]
    assert "Boondall" in names
    assert "Bigg Street" in names


# ── Create ────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_create_property_asset(client: AsyncClient):
    """POST /assets creates a property asset with all fields."""
    payload = {
        "asset_name": "Boondall",
        "asset_type": "property",
        "address_street": "12 Smith St",
        "address_suburb": "Boondall",
        "address_state": "QLD",
        "address_postcode": "4034",
        "purchase_price": 550000,
        "current_value": 680000,
        "is_rental": True,
        "rental_income_monthly": 2400,
    }
    r = await client.post("/assets", json=payload)
    assert r.status_code == 201
    data = r.json()
    assert data["asset_name"] == "Boondall"
    assert data["asset_type"] == "property"
    assert data["address_suburb"] == "Boondall"
    assert data["purchase_price"] == 550000
    assert data["current_value"] == 680000
    assert data["is_rental"] is True
    assert data["rental_income_monthly"] == 2400
    assert "id" in data


@pytest.mark.anyio
async def test_create_equity_asset(client: AsyncClient):
    """POST /assets creates an equity asset."""
    r = await client.post("/assets", json={"asset_name": "Equity Loan 1", "asset_type": "equity"})
    assert r.status_code == 201
    assert r.json()["asset_type"] == "equity"


@pytest.mark.anyio
async def test_create_stock_portfolio_asset(client: AsyncClient):
    """POST /assets creates a stock portfolio asset."""
    r = await client.post("/assets", json={"asset_name": "My Portfolio", "asset_type": "stock_portfolio"})
    assert r.status_code == 201
    assert r.json()["asset_type"] == "stock_portfolio"


@pytest.mark.anyio
async def test_create_asset_invalid_type(client: AsyncClient):
    """POST /assets with invalid asset_type returns 422."""
    r = await client.post("/assets", json={"asset_name": "X", "asset_type": "boat"})
    assert r.status_code == 422


@pytest.mark.anyio
async def test_create_asset_missing_name(client: AsyncClient):
    """POST /assets without asset_name returns 422."""
    r = await client.post("/assets", json={"asset_type": "property"})
    assert r.status_code == 422


# ── Get ───────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_get_asset_by_id(client: AsyncClient):
    """GET /assets/{id} returns the asset."""
    created = await _create_asset(client, asset_name="Kedron")
    r = await client.get(f"/assets/{created['id']}")
    assert r.status_code == 200
    assert r.json()["asset_name"] == "Kedron"


@pytest.mark.anyio
async def test_get_asset_404(client: AsyncClient):
    """GET /assets/99999 returns 404."""
    r = await client.get("/assets/99999")
    assert r.status_code == 404


# ── Update ────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_update_asset_name(client: AsyncClient):
    """PUT /assets/{id} updates the asset name."""
    created = await _create_asset(client)
    r = await client.put(f"/assets/{created['id']}", json={"asset_name": "Updated Name"})
    assert r.status_code == 200
    assert r.json()["asset_name"] == "Updated Name"


@pytest.mark.anyio
async def test_update_asset_value(client: AsyncClient):
    """PUT /assets/{id} updates current_value."""
    created = await _create_asset(client)
    r = await client.put(f"/assets/{created['id']}", json={"current_value": 750000})
    assert r.status_code == 200
    assert r.json()["current_value"] == 750000


@pytest.mark.anyio
async def test_update_asset_404(client: AsyncClient):
    """PUT /assets/99999 returns 404."""
    r = await client.put("/assets/99999", json={"asset_name": "X"})
    assert r.status_code == 404


# ── Delete ────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_delete_asset(client: AsyncClient):
    """DELETE /assets/{id} removes the asset."""
    created = await _create_asset(client)
    r = await client.delete(f"/assets/{created['id']}")
    assert r.status_code == 204
    # Verify gone
    r2 = await client.get(f"/assets/{created['id']}")
    assert r2.status_code == 404


@pytest.mark.anyio
async def test_delete_asset_404(client: AsyncClient):
    """DELETE /assets/99999 returns 404."""
    r = await client.delete("/assets/99999")
    assert r.status_code == 404


@pytest.mark.anyio
async def test_delete_asset_blocked_if_linked_to_account(client: AsyncClient):
    """DELETE /assets/{id} blocked if a loan account is linked to it."""
    asset = await _create_asset(client, asset_name="Linked Property")
    # Create a loan account linked to this asset
    await client.post("/accounts", json={
        "account_number": "TEST-LOAN-001",
        "account_name": "Test Loan",
        "bank_name": "Macquarie",
        "account_type": "home_loan",
        "asset_id": asset["id"],
    })
    r = await client.delete(f"/assets/{asset['id']}")
    assert r.status_code == 409
    assert "linked" in r.json()["detail"].lower()


# ── Response shape ────────────────────────────────────────────

@pytest.mark.anyio
async def test_asset_response_shape(client: AsyncClient):
    """Asset response includes all expected fields."""
    created = await _create_asset(client)
    assert "id" in created
    assert "asset_name" in created
    assert "asset_type" in created
    assert "is_rental" in created
    assert "created_at" in created
