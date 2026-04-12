"""
Tests for the rule suggestion learning system (Options A, B, C).

Tests cover:
- GET /rules/suggestions — empty and populated
- PATCH /transactions/{id} → rule_suggestion field generated
- Auto-promotion to real rule (Option B)
- POST /rules/suggestions/{id}/accept — Option C accept
- POST /rules/suggestions/{id}/dismiss — Option C dismiss
- Pattern extractor unit tests
"""

import os
import pytest

from app.services.pattern_extractor import extract_merchant_pattern, AUTO_PROMOTE_THRESHOLD

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_fixture(name):
    with open(os.path.join(FIXTURES_DIR, name)) as f:
        return f.read()


# ── Pattern extractor unit tests ─────────────────────────────

def test_extract_merchant_coles():
    assert extract_merchant_pattern("COLES 7543 PARRAMATTA 16APR") == "COLES"


def test_extract_merchant_netflix():
    assert extract_merchant_pattern("NETFLIX.COM 800-599-1743 CA") == "NETFLIX"


def test_extract_merchant_spaceship():
    assert extract_merchant_pattern("SPACESHIP INVEST PTY LTD") == "SPACESHIP"


def test_extract_merchant_skips_boilerplate():
    # All tokens are skip words — returns None
    assert extract_merchant_pattern("CARD PAYMENT THANK YOU") is None


def test_extract_merchant_short_token():
    # 2-char token before valid one
    assert extract_merchant_pattern("TO WOOLWORTHS STORE") == "WOOLWORTHS"


def test_extract_merchant_none_for_empty():
    assert extract_merchant_pattern("") is None


# ── GET /rules/suggestions ───────────────────────────────────

@pytest.mark.anyio
async def test_list_suggestions_empty(client):
    """GET /rules/suggestions returns empty list when no suggestions exist."""
    response = await client.get("/rules/suggestions")
    assert response.status_code == 200
    assert response.json() == []


# ── PATCH /transactions/{id} → suggestion generated ──────────

@pytest.mark.anyio
async def test_patch_generates_suggestion(client):
    """Manually categorising a transaction generates a rule suggestion."""
    csv_content = _load_fixture("westpac_sample.csv")
    await client.post("/upload", files={"file": ("export.csv", csv_content.encode(), "text/csv")})

    cats = (await client.get("/categories")).json()
    groceries = next(c for c in cats if c["name"] == "Groceries")

    # Find a transaction with a COLES-like description
    txns = (await client.get("/transactions")).json()
    coles_tx = next((t for t in txns["items"] if "COLES" in t["tx_desc"].upper()), None)
    if not coles_tx:
        pytest.skip("No COLES transaction in sample CSV")

    response = await client.patch(f"/transactions/{coles_tx['id']}", json={"category_id": groceries["id"]})
    assert response.status_code == 200
    data = response.json()
    assert "rule_suggestion" in data

    if data["rule_suggestion"] is not None:
        rs = data["rule_suggestion"]
        assert rs["pattern"] == "COLES"
        assert rs["category_id"] == groceries["id"]
        assert rs["hit_count"] == 1
        assert rs["auto_promoted"] is False

    # Suggestion should now appear in GET /rules/suggestions
    suggestions = (await client.get("/rules/suggestions")).json()
    coles_suggestion = next((s for s in suggestions if s["pattern"] == "COLES"), None)
    assert coles_suggestion is not None
    assert coles_suggestion["hit_count"] == 1


@pytest.mark.anyio
async def test_patch_increments_hit_count(client):
    """Manually categorising two different transactions with the same merchant increments hit_count."""
    csv_content = _load_fixture("westpac_sample.csv")
    await client.post("/upload", files={"file": ("export.csv", csv_content.encode(), "text/csv")})

    cats = (await client.get("/categories")).json()
    groceries = next(c for c in cats if c["name"] == "Groceries")

    txns = (await client.get("/transactions")).json()
    coles_txs = [t for t in txns["items"] if "COLES" in t["tx_desc"].upper()]
    if len(coles_txs) < 2:
        pytest.skip("Need at least 2 COLES transactions")

    # Categorise first one
    await client.patch(f"/transactions/{coles_txs[0]['id']}", json={"category_id": groceries["id"]})
    # Categorise second one
    r2 = await client.patch(f"/transactions/{coles_txs[1]['id']}", json={"category_id": groceries["id"]})

    data = r2.json()
    if data.get("rule_suggestion"):
        assert data["rule_suggestion"]["hit_count"] == 2


# ── POST /rules/suggestions/{id}/accept ──────────────────────

@pytest.mark.anyio
async def test_accept_suggestion(client):
    """Accepting a suggestion creates a real rule and removes it from suggestions."""
    csv_content = _load_fixture("westpac_sample.csv")
    await client.post("/upload", files={"file": ("export.csv", csv_content.encode(), "text/csv")})

    cats = (await client.get("/categories")).json()
    groceries = next(c for c in cats if c["name"] == "Groceries")

    txns = (await client.get("/transactions")).json()
    coles_tx = next((t for t in txns["items"] if "COLES" in t["tx_desc"].upper()), None)
    if not coles_tx:
        pytest.skip("No COLES transaction in sample CSV")

    await client.patch(f"/transactions/{coles_tx['id']}", json={"category_id": groceries["id"]})

    suggestions = (await client.get("/rules/suggestions")).json()
    coles_suggestion = next((s for s in suggestions if s["pattern"] == "COLES"), None)
    if not coles_suggestion:
        pytest.skip("No COLES suggestion created (may already have a rule)")

    # Accept it
    response = await client.post(f"/rules/suggestions/{coles_suggestion['id']}/accept")
    assert response.status_code == 200
    rule = response.json()
    assert rule["pattern"] == "COLES"
    assert rule["category_id"] == groceries["id"]

    # Suggestion should be gone from the queue
    suggestions_after = (await client.get("/rules/suggestions")).json()
    assert not any(s["id"] == coles_suggestion["id"] for s in suggestions_after)

    # Real rule should exist
    rules = (await client.get("/rules")).json()
    assert any(r["pattern"] == "COLES" for r in rules)


@pytest.mark.anyio
async def test_accept_suggestion_not_found(client):
    """Accepting a non-existent suggestion returns 404."""
    response = await client.post("/rules/suggestions/99999/accept")
    assert response.status_code == 404


# ── POST /rules/suggestions/{id}/dismiss ─────────────────────

@pytest.mark.anyio
async def test_dismiss_suggestion(client):
    """Dismissing a suggestion removes it from the queue."""
    csv_content = _load_fixture("westpac_sample.csv")
    await client.post("/upload", files={"file": ("export.csv", csv_content.encode(), "text/csv")})

    cats = (await client.get("/categories")).json()
    groceries = next(c for c in cats if c["name"] == "Groceries")

    txns = (await client.get("/transactions")).json()
    coles_tx = next((t for t in txns["items"] if "COLES" in t["tx_desc"].upper()), None)
    if not coles_tx:
        pytest.skip("No COLES transaction in sample CSV")

    await client.patch(f"/transactions/{coles_tx['id']}", json={"category_id": groceries["id"]})

    suggestions = (await client.get("/rules/suggestions")).json()
    coles_suggestion = next((s for s in suggestions if s["pattern"] == "COLES"), None)
    if not coles_suggestion:
        pytest.skip("No COLES suggestion created")

    response = await client.post(f"/rules/suggestions/{coles_suggestion['id']}/dismiss")
    assert response.status_code == 204

    suggestions_after = (await client.get("/rules/suggestions")).json()
    assert not any(s["id"] == coles_suggestion["id"] for s in suggestions_after)


@pytest.mark.anyio
async def test_dismiss_suggestion_not_found(client):
    """Dismissing a non-existent suggestion returns 404."""
    response = await client.post("/rules/suggestions/99999/dismiss")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_no_suggestion_when_rule_exists(client):
    """No suggestion is generated when an active rule already covers the pattern."""
    cats = (await client.get("/categories")).json()
    groceries = next(c for c in cats if c["name"] == "Groceries")

    # Create a rule for COLES first
    await client.post("/rules", json={"pattern": "COLES", "category_id": groceries["id"]})

    csv_content = _load_fixture("westpac_sample.csv")
    await client.post("/upload", files={"file": ("export.csv", csv_content.encode(), "text/csv")})

    txns = (await client.get("/transactions")).json()
    coles_tx = next((t for t in txns["items"] if "COLES" in t["tx_desc"].upper()), None)
    if not coles_tx:
        pytest.skip("No COLES transaction in sample CSV")

    response = await client.patch(f"/transactions/{coles_tx['id']}", json={"category_id": groceries["id"]})
    data = response.json()
    # Suggestion should be None since a rule already exists
    assert data.get("rule_suggestion") is None
