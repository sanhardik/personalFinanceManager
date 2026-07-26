"""Tests for transaction splitting (POST/DELETE /transactions/{id}/split)."""
import hashlib
import pytest
from sqlalchemy import text as sqla_text
from httpx import AsyncClient


# ── Helpers ───────────────────────────────────────────────────

_COUNTER = 0


def _next_suffix() -> str:
    """Return a unique suffix to avoid account_number collisions across tests."""
    global _COUNTER
    _COUNTER += 1
    return str(_COUNTER)


async def _make_account(client, suffix: str) -> int:
    """Create a bank account via the API and return its id."""
    r = await client.post("/accounts", json={
        "account_name": f"Split Account {suffix}",
        "account_number": f"SPLITACC{suffix}",
        "bank_name": "NAB",
        "account_type": "bank",
    })
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _insert_tx(
    db_session,
    client,
    account_id: int,
    amount: float = 1000.0,
    tx_type: str = "Income",
    desc: str = "Combined repayment",
    tx_date: str = "2025-06-01",
) -> int:
    """
    Insert a transaction via raw SQL (like test_lending.py pattern) and
    return its id by fetching via the client.

    Note: id is retrieved via GET /transactions to avoid a second db_session
    SELECT that can cause event-loop teardown issues.
    """
    h = hashlib.sha256(
        f"{account_id}|{tx_date} 00:00:00|{desc}|{amount}".encode()
    ).hexdigest()
    await db_session.execute(
        sqla_text(
            "INSERT INTO transactions "
            "(account_id, tx_date, tx_desc, tx_amount, tx_type, tx_hash, is_categorised) "
            "VALUES (:acc, :dt, :desc, :amt, :typ, :hash, 0)"
        ),
        {
            "acc": account_id,
            "dt": tx_date,
            "desc": desc,
            "amt": amount,
            "typ": tx_type,
            "hash": h,
        },
    )
    await db_session.commit()

    # Retrieve the inserted id via client (avoids a second db_session SELECT)
    r = await client.get("/transactions", params={"account_id": account_id})
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1, f"Expected 1 tx, got {len(items)}"
    return items[0]["id"]


# ── Split creation ────────────────────────────────────────────

@pytest.mark.anyio
async def test_split_creates_children(client: AsyncClient, db_session):
    """POST /transactions/{id}/split creates 3 child transactions nested in the response."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=1000.0)

    r = await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "Loan A repayment", "amount": 500.0, "lending_loan_id": None},
        {"description": "Loan B repayment", "amount": 300.0, "lending_loan_id": None},
        {"description": "Loan C repayment", "amount": 200.0, "lending_loan_id": None},
    ]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["is_split_parent"] is True
    # Splits should be nested in the POST response
    assert data["splits"] is not None
    assert len(data["splits"]) == 3
    amounts = sorted(s["tx_amount"] for s in data["splits"])
    assert amounts == [200.0, 300.0, 500.0]


@pytest.mark.anyio
async def test_split_sets_descriptions(client: AsyncClient, db_session):
    """Children carry the descriptions provided in each split item (nested in POST response)."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=600.0, desc="Bulk payment")

    r = await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "Alice share", "amount": 400.0},
        {"description": "Bob share", "amount": 200.0},
    ]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["splits"] is not None
    descs = {s["tx_desc"] for s in data["splits"]}
    assert descs == {"Alice share", "Bob share"}


# ── List / Dashboard exclusion ────────────────────────────────

@pytest.mark.anyio
async def test_split_parent_in_list_children_excluded(client: AsyncClient, db_session):
    """Parent appears in top-level list; children are sub-rows not in top-level list."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=800.0, desc="Big payment")

    await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "Part 1", "amount": 500.0},
        {"description": "Part 2", "amount": 300.0},
    ]})

    r = await client.get("/transactions", params={"account_id": acc_id})
    items = r.json()["items"]
    ids = [t["id"] for t in items]
    assert tx_id in ids        # parent IS in list
    assert len(ids) == 1       # children NOT in top-level list
    # Parent row has is_split_parent=True and nested splits
    parent_row = next(t for t in items if t["id"] == tx_id)
    assert parent_row["is_split_parent"] is True
    assert parent_row["splits"] is not None
    assert len(parent_row["splits"]) == 2


@pytest.mark.anyio
async def test_split_parent_excluded_from_dashboard(client: AsyncClient, db_session):
    """Dashboard total_income must be unchanged after splitting (parent out, children in)."""
    # Use a narrow date range (2020) unlikely to clash with other test transactions
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(
        db_session, client, acc_id,
        amount=1000.0, tx_type="Income",
        desc="Income dashboard test", tx_date="2020-06-15",
    )

    r = await client.get("/dashboard/summary", params={"date_from": "2020-01-01", "date_to": "2020-12-31"})
    income_before = r.json()["total_income"]

    await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "Child A", "amount": 600.0},
        {"description": "Child B", "amount": 400.0},
    ]})

    r = await client.get("/dashboard/summary", params={"date_from": "2020-01-01", "date_to": "2020-12-31"})
    income_after = r.json()["total_income"]
    # Net income unchanged: parent ($1000) replaced by children ($600 + $400)
    assert abs(income_after - income_before) < 0.02


# ── Validation ────────────────────────────────────────────────

@pytest.mark.anyio
async def test_split_rejects_wrong_sum(client: AsyncClient, db_session):
    """Splits that don't add up to the parent amount should return 422."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=1000.0, desc="Wrong sum test")

    r = await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "Part 1", "amount": 600.0},
        {"description": "Part 2", "amount": 600.0},
    ]})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "1200" in detail or "sum" in detail.lower()


@pytest.mark.anyio
async def test_split_rejects_single_item(client: AsyncClient, db_session):
    """A split list with only one item should be rejected (min_length=2)."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=500.0, desc="Single split test")

    r = await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "Only one", "amount": 500.0},
    ]})
    assert r.status_code == 422


@pytest.mark.anyio
async def test_split_rejects_child_transaction(client: AsyncClient, db_session):
    """Splitting a child transaction should return 400."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=1000.0, desc="Child split test")

    r = await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "A", "amount": 600.0},
        {"description": "B", "amount": 400.0},
    ]})
    assert r.status_code == 200, r.text

    # Find child id from the nested splits in the POST response
    # (children are excluded from the top-level GET /transactions list)
    child_id = r.json()["splits"][0]["id"]

    r3 = await client.post(f"/transactions/{child_id}/split", json={"splits": [
        {"description": "X", "amount": 400.0},
        {"description": "Y", "amount": 200.0},
    ]})
    assert r3.status_code == 400


@pytest.mark.anyio
async def test_split_404_on_unknown_tx(client: AsyncClient, db_session):
    """Splitting a non-existent transaction id should return 404."""
    r = await client.post("/transactions/999999/split", json={"splits": [
        {"description": "A", "amount": 100.0},
        {"description": "B", "amount": 100.0},
    ]})
    assert r.status_code == 404


# ── Unsplit ───────────────────────────────────────────────────

@pytest.mark.anyio
async def test_unsplit_removes_children(client: AsyncClient, db_session):
    """DELETE /transactions/{id}/split removes children and restores the parent."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=700.0, desc="Unsplit test")

    await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "X", "amount": 400.0},
        {"description": "Y", "amount": 300.0},
    ]})

    r = await client.delete(f"/transactions/{tx_id}/split")
    assert r.status_code == 200, r.text
    assert r.json()["is_split_parent"] is False

    r2 = await client.get("/transactions", params={"account_id": acc_id})
    items = r2.json()["items"]
    ids = [t["id"] for t in items]
    assert tx_id in ids
    assert len(ids) == 1


@pytest.mark.anyio
async def test_unsplit_rejects_non_parent(client: AsyncClient, db_session):
    """DELETE /transactions/{id}/split on a normal transaction should return 400."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=500.0, desc="Non-parent unsplit")

    r = await client.delete(f"/transactions/{tx_id}/split")
    assert r.status_code == 400


# ── Re-split ──────────────────────────────────────────────────

@pytest.mark.anyio
async def test_resplit_replaces_children(client: AsyncClient, db_session):
    """POSTing split a second time replaces the existing children."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=900.0, desc="Resplit test")

    # First split: 2 children
    await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "First A", "amount": 500.0},
        {"description": "First B", "amount": 400.0},
    ]})

    # Second split: 3 different children
    r = await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "New A", "amount": 300.0},
        {"description": "New B", "amount": 300.0},
        {"description": "New C", "amount": 300.0},
    ]})
    assert r.status_code == 200, r.text
    data = r.json()
    # Check nested splits in POST response (children excluded from top-level GET list)
    assert data["splits"] is not None
    descs = {s["tx_desc"] for s in data["splits"]}
    assert len(data["splits"]) == 3
    assert "First A" not in descs
    assert "New A" in descs


# ── Uncategorised accounting ──────────────────────────────────

@pytest.mark.anyio
async def test_split_parent_marked_categorised(client: AsyncClient, db_session):
    """A split parent is 'resolved' — its own is_categorised flips to True on split."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=1000.0, desc="Resolve me")

    r = await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "A", "amount": 600.0},
        {"description": "B", "amount": 400.0},
    ]})
    assert r.status_code == 200, r.text
    assert r.json()["is_categorised"] is True


@pytest.mark.anyio
async def test_split_parent_not_counted_uncategorised(client: AsyncClient, db_session):
    """Splitting must drop the uncategorised count by 1 (parent resolved, children not
    in the top-level count universe) — not inflate it via uncategorised children."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=1000.0, desc="Count me")

    before = (await client.get("/transactions/count")).json()["uncategorised"]

    r = await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "A", "amount": 600.0},
        {"description": "B", "amount": 400.0},
    ]})
    assert r.status_code == 200, r.text

    after = (await client.get("/transactions/count")).json()["uncategorised"]
    assert after == before - 1


@pytest.mark.anyio
async def test_split_parent_absent_from_uncategorised_groups(client: AsyncClient, db_session):
    """A split parent (and its children) must not appear in the categorise drawer groups."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=800.0, desc="Grouped payment")

    await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "A", "amount": 500.0},
        {"description": "B", "amount": 300.0},
    ]})

    groups = (await client.get("/transactions/uncategorised-groups")).json()
    all_descs = {g.get("description") or g.get("pattern") for g in groups}
    assert "Grouped payment" not in all_descs
    assert "A" not in all_descs and "B" not in all_descs


@pytest.mark.anyio
async def test_unsplit_restores_uncategorised(client: AsyncClient, db_session):
    """Removing a split reverts the parent's is_categorised from its own category_id."""
    acc_id = await _make_account(client, _next_suffix())
    tx_id = await _insert_tx(db_session, client, acc_id, amount=500.0, desc="Undo me")

    await client.post(f"/transactions/{tx_id}/split", json={"splits": [
        {"description": "A", "amount": 300.0},
        {"description": "B", "amount": 200.0},
    ]})

    r = await client.delete(f"/transactions/{tx_id}/split")
    assert r.status_code == 200, r.text
    # Parent had no category of its own → uncategorised again after unsplit
    assert r.json()["is_categorised"] is False
