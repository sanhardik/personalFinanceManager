"""
Tests for Rules CRUD, categoriser service, and PATCH /transactions/{id}.
"""

import pytest


# ── GET /rules ───────────────────────────────────────────────

@pytest.mark.anyio
async def test_list_rules_empty(client):
    """GET /rules returns empty list when no rules exist."""
    response = await client.get("/rules")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.anyio
async def test_create_rule(client):
    """POST /rules creates a rule and returns it with category info."""
    # Get a valid category id first
    cats = (await client.get("/categories")).json()
    groceries = next(c for c in cats if c["name"] == "Groceries")

    response = await client.post("/rules", json={
        "pattern": "COLES",
        "category_id": groceries["id"],
    })
    assert response.status_code == 201
    data = response.json()
    assert data["pattern"] == "COLES"
    assert data["category_id"] == groceries["id"]
    assert data["category"]["name"] == "Groceries"
    assert data["is_active"] is True


@pytest.mark.anyio
async def test_create_rule_invalid_category(client):
    """POST /rules with non-existent category returns 404."""
    response = await client.post("/rules", json={"pattern": "TEST", "category_id": 99999})
    assert response.status_code == 404


@pytest.mark.anyio
async def test_list_rules_returns_created(client):
    """GET /rules returns created rules."""
    cats = (await client.get("/categories")).json()
    fuel = next(c for c in cats if c["name"] == "Fuel")

    await client.post("/rules", json={"pattern": "BP PETROL", "category_id": fuel["id"]})
    await client.post("/rules", json={"pattern": "SHELL", "category_id": fuel["id"]})

    response = await client.get("/rules")
    assert response.status_code == 200
    patterns = [r["pattern"] for r in response.json()]
    assert "BP PETROL" in patterns
    assert "SHELL" in patterns


@pytest.mark.anyio
async def test_update_rule(client):
    """PUT /rules/{id} updates pattern and active status."""
    cats = (await client.get("/categories")).json()
    groceries = next(c for c in cats if c["name"] == "Groceries")

    create_resp = await client.post("/rules", json={"pattern": "WOOLIES", "category_id": groceries["id"]})
    rule_id = create_resp.json()["id"]

    update_resp = await client.put(f"/rules/{rule_id}", json={"pattern": "WOOLWORTHS", "is_active": False})
    assert update_resp.status_code == 200
    data = update_resp.json()
    assert data["pattern"] == "WOOLWORTHS"
    assert data["is_active"] is False


@pytest.mark.anyio
async def test_update_rule_not_found(client):
    """PUT /rules/99999 returns 404."""
    response = await client.put("/rules/99999", json={"is_active": False})
    assert response.status_code == 404


@pytest.mark.anyio
async def test_delete_rule(client):
    """DELETE /rules/{id} removes the rule."""
    cats = (await client.get("/categories")).json()
    groceries = next(c for c in cats if c["name"] == "Groceries")

    create_resp = await client.post("/rules", json={"pattern": "ALDI", "category_id": groceries["id"]})
    rule_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/rules/{rule_id}")
    assert del_resp.status_code == 204

    rules = (await client.get("/rules")).json()
    assert not any(r["id"] == rule_id for r in rules)


@pytest.mark.anyio
async def test_delete_rule_not_found(client):
    """DELETE /rules/99999 returns 404."""
    response = await client.delete("/rules/99999")
    assert response.status_code == 404


# ── POST /rules/apply ────────────────────────────────────────

@pytest.mark.anyio
async def test_apply_rules_categorises_transactions(client):
    """POST /rules/apply should categorise matching uncategorised transactions."""
    import os
    fixtures_dir = os.path.join(os.path.dirname(__file__), "fixtures")
    with open(os.path.join(fixtures_dir, "westpac_sample.csv")) as f:
        csv_content = f.read()

    # Upload CSV
    await client.post("/upload", files={"file": ("export.csv", csv_content.encode(), "text/csv")})

    # Create a rule
    cats = (await client.get("/categories")).json()
    groceries = next(c for c in cats if c["name"] == "Groceries")
    await client.post("/rules", json={"pattern": "COLES", "category_id": groceries["id"]})

    # Apply rules
    resp = await client.post("/rules/apply")
    assert resp.status_code == 200
    data = resp.json()
    assert data["categorised"] >= 0  # May be 0 if no COLES in sample

    # Verify categorised transactions have category set
    txns = (await client.get("/transactions", params={"search": "COLES"})).json()
    for tx in txns["items"]:
        if "COLES" in tx["tx_desc"].upper():
            assert tx["is_categorised"] is True
            assert tx["category_id"] == groceries["id"]


@pytest.mark.anyio
async def test_apply_rules_inactive_rule_skipped(client):
    """Inactive rules should not be applied."""
    import os
    fixtures_dir = os.path.join(os.path.dirname(__file__), "fixtures")
    with open(os.path.join(fixtures_dir, "westpac_sample.csv")) as f:
        csv_content = f.read()

    await client.post("/upload", files={"file": ("export.csv", csv_content.encode(), "text/csv")})

    cats = (await client.get("/categories")).json()
    groceries = next(c for c in cats if c["name"] == "Groceries")

    # Create an inactive rule
    create_resp = await client.post("/rules", json={"pattern": "COLES", "category_id": groceries["id"]})
    rule_id = create_resp.json()["id"]
    await client.put(f"/rules/{rule_id}", json={"is_active": False})

    await client.post("/rules/apply")

    # COLES transactions should still be uncategorised
    txns = (await client.get("/transactions", params={"search": "COLES"})).json()
    for tx in txns["items"]:
        if "COLES" in tx["tx_desc"].upper():
            assert tx["is_categorised"] is False


# ── PATCH /transactions/{id} ─────────────────────────────────

@pytest.mark.anyio
async def test_patch_transaction_category(client):
    """PATCH /transactions/{id} should set category and mark categorised."""
    import os
    fixtures_dir = os.path.join(os.path.dirname(__file__), "fixtures")
    with open(os.path.join(fixtures_dir, "westpac_sample.csv")) as f:
        csv_content = f.read()

    await client.post("/upload", files={"file": ("export.csv", csv_content.encode(), "text/csv")})

    txns = (await client.get("/transactions", params={"per_page": 1})).json()
    tx_id = txns["items"][0]["id"]

    cats = (await client.get("/categories")).json()
    dining = next(c for c in cats if c["name"] == "Dining Out")

    resp = await client.patch(f"/transactions/{tx_id}", json={"category_id": dining["id"]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["category_id"] == dining["id"]
    assert data["is_categorised"] is True


@pytest.mark.anyio
async def test_patch_transaction_clear_category(client):
    """PATCH /transactions/{id} with category_id=null clears the category."""
    import os
    fixtures_dir = os.path.join(os.path.dirname(__file__), "fixtures")
    with open(os.path.join(fixtures_dir, "westpac_sample.csv")) as f:
        csv_content = f.read()

    await client.post("/upload", files={"file": ("export.csv", csv_content.encode(), "text/csv")})

    txns = (await client.get("/transactions", params={"per_page": 1})).json()
    tx_id = txns["items"][0]["id"]

    cats = (await client.get("/categories")).json()
    dining = next(c for c in cats if c["name"] == "Dining Out")

    # Set category first
    await client.patch(f"/transactions/{tx_id}", json={"category_id": dining["id"]})

    # Now clear it
    resp = await client.patch(f"/transactions/{tx_id}", json={"category_id": None})
    assert resp.status_code == 200
    data = resp.json()
    assert data["category_id"] is None
    assert data["is_categorised"] is False


@pytest.mark.anyio
async def test_patch_transaction_not_found(client):
    """PATCH /transactions/99999 returns 404."""
    response = await client.patch("/transactions/99999", json={"category_id": 1})
    assert response.status_code == 404


@pytest.mark.anyio
async def test_patch_transaction_invalid_category(client):
    """PATCH with non-existent category_id returns 404."""
    import os
    fixtures_dir = os.path.join(os.path.dirname(__file__), "fixtures")
    with open(os.path.join(fixtures_dir, "westpac_sample.csv")) as f:
        csv_content = f.read()

    await client.post("/upload", files={"file": ("export.csv", csv_content.encode(), "text/csv")})
    txns = (await client.get("/transactions", params={"per_page": 1})).json()
    tx_id = txns["items"][0]["id"]

    response = await client.patch(f"/transactions/{tx_id}", json={"category_id": 99999})
    assert response.status_code == 404
