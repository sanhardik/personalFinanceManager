"""
Tests for the /categories API endpoints.

These tests run against the FastAPI app via ASGI transport (no real DB needed
for the HTTP layer tests — but the app will attempt DB connections on lifespan).

Test coverage:
- List categories (GET /categories)
- Create category (POST /categories)
- Get single category (GET /categories/{id})
- Update category (PUT /categories/{id})
- Delete category (DELETE /categories/{id})
- Validation and error cases
"""

import pytest


# ── GET /categories ──────────────────────────────────────────

@pytest.mark.anyio
async def test_list_categories_returns_200(client):
    """GET /categories should return 200 with a list."""
    response = await client.get("/categories")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.anyio
async def test_list_categories_has_seeded_data(client):
    """Seeded categories should appear in the list."""
    response = await client.get("/categories")
    data = response.json()
    names = [c["name"] for c in data]
    # Check a few known seeded categories
    assert "Groceries" in names
    assert "Salary" in names
    assert "Utilities" in names


@pytest.mark.anyio
async def test_list_categories_filter_by_expense(client):
    """Filter by category_type=Expense should only return expenses."""
    response = await client.get("/categories", params={"category_type": "Expense"})
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    for cat in data:
        assert cat["category_type"] == "Expense"


@pytest.mark.anyio
async def test_list_categories_filter_by_income(client):
    """Filter by category_type=Income should only return income categories."""
    response = await client.get("/categories", params={"category_type": "Income"})
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    for cat in data:
        assert cat["category_type"] == "Income"


@pytest.mark.anyio
async def test_list_categories_invalid_filter(client):
    """Invalid category_type filter should return 422."""
    response = await client.get("/categories", params={"category_type": "Invalid"})
    assert response.status_code == 422


# ── POST /categories ─────────────────────────────────────────

@pytest.mark.anyio
async def test_create_category_returns_201(client):
    """POST /categories with valid data should return 201."""
    response = await client.post(
        "/categories",
        json={"name": "Test Category Unique 123", "category_type": "Expense"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Category Unique 123"
    assert data["category_type"] == "Expense"
    assert data["is_system"] is False
    assert "id" in data

    # Cleanup: delete the test category
    await client.delete(f"/categories/{data['id']}")


@pytest.mark.anyio
async def test_create_category_income_type(client):
    """Creating an Income category should work."""
    response = await client.post(
        "/categories",
        json={"name": "Test Income Cat 456", "category_type": "Income"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["category_type"] == "Income"

    # Cleanup
    await client.delete(f"/categories/{data['id']}")


@pytest.mark.anyio
async def test_create_duplicate_category_returns_409(client):
    """Creating a category with an existing name should return 409."""
    response = await client.post(
        "/categories",
        json={"name": "Groceries", "category_type": "Expense"},
    )
    assert response.status_code == 409


@pytest.mark.anyio
async def test_create_category_empty_name_returns_422(client):
    """Empty name should fail validation."""
    response = await client.post(
        "/categories",
        json={"name": "", "category_type": "Expense"},
    )
    assert response.status_code == 422


@pytest.mark.anyio
async def test_create_category_invalid_type_returns_422(client):
    """Invalid category_type should fail validation."""
    response = await client.post(
        "/categories",
        json={"name": "Bad Type Cat", "category_type": "SomethingElse"},
    )
    assert response.status_code == 422


# ── GET /categories/{id} ────────────────────────────────────

@pytest.mark.anyio
async def test_get_category_by_id(client):
    """GET /categories/{id} should return the correct category."""
    # Get first category from list
    list_resp = await client.get("/categories")
    cats = list_resp.json()
    assert len(cats) > 0

    cat_id = cats[0]["id"]
    response = await client.get(f"/categories/{cat_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == cat_id
    assert data["name"] == cats[0]["name"]


@pytest.mark.anyio
async def test_get_nonexistent_category_returns_404(client):
    """GET /categories/99999 should return 404."""
    response = await client.get("/categories/99999")
    assert response.status_code == 404


# ── PUT /categories/{id} ────────────────────────────────────

@pytest.mark.anyio
async def test_update_category(client):
    """PUT /categories/{id} should update the category."""
    # Create a test category
    create_resp = await client.post(
        "/categories",
        json={"name": "Update Test Cat 789", "category_type": "Expense"},
    )
    cat_id = create_resp.json()["id"]

    # Update it
    update_resp = await client.put(
        f"/categories/{cat_id}",
        json={"name": "Updated Name 789", "category_type": "Income"},
    )
    assert update_resp.status_code == 200
    data = update_resp.json()
    assert data["name"] == "Updated Name 789"
    assert data["category_type"] == "Income"

    # Cleanup
    await client.delete(f"/categories/{cat_id}")


# ── DELETE /categories/{id} ──────────────────────────────────

@pytest.mark.anyio
async def test_delete_user_category(client):
    """DELETE /categories/{id} should remove a non-system category."""
    # Create a test category
    create_resp = await client.post(
        "/categories",
        json={"name": "Delete Test Cat 101", "category_type": "Expense"},
    )
    cat_id = create_resp.json()["id"]

    # Delete it
    delete_resp = await client.delete(f"/categories/{cat_id}")
    assert delete_resp.status_code == 204

    # Verify it's gone
    get_resp = await client.get(f"/categories/{cat_id}")
    assert get_resp.status_code == 404


@pytest.mark.anyio
async def test_delete_system_category_returns_403(client):
    """System categories should not be deletable."""
    # Get a system category (seeded ones are system)
    list_resp = await client.get("/categories")
    system_cats = [c for c in list_resp.json() if c["is_system"]]
    assert len(system_cats) > 0

    response = await client.delete(f"/categories/{system_cats[0]['id']}")
    assert response.status_code == 403


@pytest.mark.anyio
async def test_delete_nonexistent_category_returns_404(client):
    """DELETE /categories/99999 should return 404."""
    response = await client.delete("/categories/99999")
    assert response.status_code == 404


# ── Category response shape ─────────────────────────────────

@pytest.mark.anyio
async def test_category_response_has_all_fields(client):
    """Category response should include all expected fields."""
    response = await client.get("/categories")
    data = response.json()
    assert len(data) > 0

    cat = data[0]
    expected_fields = {"id", "name", "category_type", "icon", "colour", "is_system", "created_at"}
    assert expected_fields.issubset(set(cat.keys()))
