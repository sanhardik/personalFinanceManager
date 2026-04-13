"""
Tests for GET /dashboard/* endpoints.

Verifies:
- Summary totals (income, expenses, savings, uncategorised count)
- Transfer categories are excluded from all calculations
- Monthly grouping is correct
- By-category grouping works for Income and Expense
- Uncategorised transactions show as "Uncategorised" bucket
- Date range filtering works (out-of-range transactions excluded)
"""

import pytest
from datetime import date
from sqlalchemy import text

pytestmark = pytest.mark.anyio


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_category_id(db_session, name: str) -> int:
    result = await db_session.execute(
        text("SELECT id FROM categories WHERE name = :name"), {"name": name}
    )
    row = result.fetchone()
    assert row, f"Seed category '{name}' not found — is the test DB seeded?"
    return row[0]


async def _insert_account(db_session, account_number="TEST001") -> int:
    await db_session.execute(text(
        "INSERT INTO accounts (account_number, account_name, bank_name, account_type, is_active) "
        "VALUES (:num, 'Test Account', 'TestBank', 'bank', 1)"
    ), {"num": account_number})
    await db_session.commit()
    result = await db_session.execute(
        text("SELECT id FROM accounts WHERE account_number = :num"), {"num": account_number}
    )
    return result.scalar_one()


async def _insert_tx(db_session, account_id, tx_date, tx_desc, tx_amount, tx_type,
                     category_id=None, is_categorised=None):
    if is_categorised is None:
        is_categorised = category_id is not None
    tx_hash = f"hash-{tx_desc}-{tx_date}-{tx_amount}"
    await db_session.execute(text(
        "INSERT INTO transactions "
        "(account_id, category_id, tx_date, tx_desc, tx_amount, tx_type, tx_hash, is_categorised) "
        "VALUES (:acc, :cat, :date, :desc, :amt, :type, :hash, :cat_b)"
    ), {
        "acc": account_id, "cat": category_id, "date": tx_date,
        "desc": tx_desc, "amt": tx_amount, "type": tx_type,
        "hash": tx_hash, "cat_b": is_categorised,
    })
    await db_session.commit()


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
async def seeded(db_session, client):
    """
    Insert a small known dataset:
      Jan 2026 - Salary $5000 (Income/categorised), Groceries $200 (Expense/categorised)
      Feb 2026 - Salary $5000 (Income/categorised), Rent $1500 + Groceries $300 (Expense/categorised)
                 Transfer Out $1000 (should be EXCLUDED)
                 Uncategorised expense $50 (no category)
      Mar 2026 - Out of range (used to test date filtering)
    """
    groceries_id = await _get_category_id(db_session, "Groceries")
    salary_id = await _get_category_id(db_session, "Salary")
    rent_id = await _get_category_id(db_session, "Rent")
    transfer_out_id = await _get_category_id(db_session, "Transfer Out")

    acc_id = await _insert_account(db_session)

    # Jan 2026
    await _insert_tx(db_session, acc_id, "2026-01-15", "SALARY", 5000, "Income", salary_id)
    await _insert_tx(db_session, acc_id, "2026-01-20", "COLES", 200, "Expense", groceries_id)

    # Feb 2026
    await _insert_tx(db_session, acc_id, "2026-02-15", "SALARY", 5000, "Income", salary_id)
    await _insert_tx(db_session, acc_id, "2026-02-01", "RENT", 1500, "Expense", rent_id)
    await _insert_tx(db_session, acc_id, "2026-02-10", "COLES", 300, "Expense", groceries_id)
    await _insert_tx(db_session, acc_id, "2026-02-20", "TRANSFER", 1000, "Expense", transfer_out_id)
    await _insert_tx(db_session, acc_id, "2026-02-25", "MISC", 50, "Expense")  # uncategorised

    # Mar 2026 (out of range for Jan–Feb queries)
    await _insert_tx(db_session, acc_id, "2026-03-10", "SALARY", 5000, "Income", salary_id)

    return {"groceries_id": groceries_id, "salary_id": salary_id}


# ── Summary tests ─────────────────────────────────────────────────────────────

async def test_summary_totals(client, seeded):
    r = await client.get("/dashboard/summary", params={"date_from": "2026-01-01", "date_to": "2026-02-28"})
    assert r.status_code == 200
    d = r.json()
    # Income: 5000 + 5000 = 10000 (transfers excluded)
    assert d["total_income"] == 10000.0
    # Expenses: 200 + 1500 + 300 + 50 = 2050 (transfer $1000 excluded)
    assert d["total_expenses"] == 2050.0
    assert d["net_savings"] == pytest.approx(7950.0)


async def test_summary_uncategorised_count(client, seeded):
    r = await client.get("/dashboard/summary", params={"date_from": "2026-01-01", "date_to": "2026-02-28"})
    assert r.status_code == 200
    # Only the MISC $50 in Feb is uncategorised (within date range, non-transfer)
    assert r.json()["uncategorised_count"] == 1


async def test_summary_transfer_excluded(client, seeded):
    """Transfer Out $1000 must not appear in expenses total."""
    r = await client.get("/dashboard/summary", params={"date_from": "2026-02-01", "date_to": "2026-02-28"})
    d = r.json()
    # Feb expenses without transfer: 1500 + 300 + 50 = 1850
    assert d["total_expenses"] == 1850.0


async def test_summary_date_range_filters(client, seeded):
    """Transactions outside the date range must be excluded."""
    # Jan only
    r = await client.get("/dashboard/summary", params={"date_from": "2026-01-01", "date_to": "2026-01-31"})
    d = r.json()
    assert d["total_income"] == 5000.0
    assert d["total_expenses"] == 200.0


async def test_summary_empty_range(client, seeded):
    r = await client.get("/dashboard/summary", params={"date_from": "2025-01-01", "date_to": "2025-01-31"})
    d = r.json()
    assert d["total_income"] == 0.0
    assert d["total_expenses"] == 0.0
    assert d["net_savings"] == 0.0


# ── Monthly tests ─────────────────────────────────────────────────────────────

async def test_monthly_grouping(client, seeded):
    r = await client.get("/dashboard/monthly", params={"date_from": "2026-01-01", "date_to": "2026-02-28"})
    assert r.status_code == 200
    months = {m["month"]: m for m in r.json()}
    assert "2026-01" in months
    assert "2026-02" in months
    assert months["2026-01"]["income"] == 5000.0
    assert months["2026-01"]["expenses"] == 200.0
    assert months["2026-01"]["savings"] == pytest.approx(4800.0)


async def test_monthly_excludes_transfers(client, seeded):
    r = await client.get("/dashboard/monthly", params={"date_from": "2026-02-01", "date_to": "2026-02-28"})
    months = {m["month"]: m for m in r.json()}
    # Feb expenses: 1500 + 300 + 50 = 1850 (not 2850)
    assert months["2026-02"]["expenses"] == 1850.0


async def test_monthly_ordered_by_month(client, seeded):
    r = await client.get("/dashboard/monthly", params={"date_from": "2026-01-01", "date_to": "2026-02-28"})
    months = [m["month"] for m in r.json()]
    assert months == sorted(months)


# ── By-category tests ─────────────────────────────────────────────────────────

async def test_by_category_expense(client, seeded):
    r = await client.get("/dashboard/by-category", params={
        "tx_type": "Expense", "date_from": "2026-01-01", "date_to": "2026-02-28",
    })
    assert r.status_code == 200
    cats = {c["category_name"]: c["amount"] for c in r.json()}
    assert cats["Rent"] == 1500.0
    assert cats["Groceries"] == 500.0   # 200 + 300
    assert cats["Uncategorised"] == 50.0
    assert "Transfer Out" not in cats


async def test_by_category_income(client, seeded):
    r = await client.get("/dashboard/by-category", params={
        "tx_type": "Income", "date_from": "2026-01-01", "date_to": "2026-02-28",
    })
    cats = {c["category_name"]: c["amount"] for c in r.json()}
    assert cats["Salary"] == 10000.0
    assert "Transfer In" not in cats


async def test_by_category_sorted_desc(client, seeded):
    r = await client.get("/dashboard/by-category", params={
        "tx_type": "Expense", "date_from": "2026-01-01", "date_to": "2026-02-28",
    })
    amounts = [c["amount"] for c in r.json()]
    assert amounts == sorted(amounts, reverse=True)


async def test_by_category_invalid_type(client, seeded):
    r = await client.get("/dashboard/by-category", params={
        "tx_type": "Transfer", "date_from": "2026-01-01", "date_to": "2026-02-28",
    })
    assert r.status_code == 422
