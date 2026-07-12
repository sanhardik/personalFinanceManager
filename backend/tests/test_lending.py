"""
Tests for the /lending endpoints — loans the user has given out.

Covers:
- CRUD for LendingLoan
- Validation (required fields, positive principal, valid types)
- Amortisation schedule: P&I and interest-only
- Schedule enrichment with linked repayment transactions
- Open-ended loans (term_months=None)
- Property-share loans with asset linkage
- Linking/unlinking transactions via PATCH /transactions
- Portfolio summary aggregations
"""

import pytest
from httpx import AsyncClient


# ── Helpers ───────────────────────────────────────────────────

def _loan_payload(**overrides):
    base = {
        "loan_name": "Test Personal Loan",
        "loan_type": "personal",
        "borrower_name": "Jane Doe",
        "principal": 50000.0,
        "interest_rate": 8.0,
        "start_date": "2025-01-01T00:00:00",
        "term_months": 24,
        "repayment_type": "principal_and_interest",
        "status": "active",
    }
    base.update(overrides)
    return base


async def _create_loan(client, **overrides):
    payload = _loan_payload(**overrides)
    r = await client.post("/lending", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def _create_account_and_transaction(client):
    """Create a bank account + one transaction for PATCH tests."""
    acc_r = await client.post("/accounts", json={
        "account_number": "LEND-TEST-001",
        "account_name": "Test Account",
        "bank_name": "TestBank",
        "account_type": "bank",
    })
    assert acc_r.status_code == 201, acc_r.text
    account_id = acc_r.json()["id"]

    import hashlib
    tx_hash = hashlib.sha256(f"{account_id}|2025-06-01|Test disbursement|50000.0".encode()).hexdigest()

    from sqlalchemy import text
    return account_id, tx_hash


# ── Create ────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_create_pi_loan(client: AsyncClient):
    """POST /lending creates a P&I loan with 201 and all fields."""
    r = await client.post("/lending", json=_loan_payload())
    assert r.status_code == 201
    data = r.json()
    assert data["loan_name"] == "Test Personal Loan"
    assert data["loan_type"] == "personal"
    assert data["borrower_name"] == "Jane Doe"
    assert data["principal"] == 50000.0
    assert data["interest_rate"] == 8.0
    assert data["term_months"] == 24
    assert data["repayment_type"] == "principal_and_interest"
    assert data["status"] == "active"
    assert "id" in data
    assert "created_at" in data
    assert "monthly_payment" in data
    assert "total_interest" in data
    assert data["total_repaid"] == 0.0
    assert data["disbursed_amount"] == 0.0


@pytest.mark.anyio
async def test_create_interest_only_loan(client: AsyncClient):
    """POST /lending creates an interest-only loan with 201."""
    r = await client.post("/lending", json=_loan_payload(
        loan_name="IO Loan",
        repayment_type="interest_only",
    ))
    assert r.status_code == 201
    data = r.json()
    assert data["repayment_type"] == "interest_only"
    # Monthly payment = principal * rate/12
    expected = round(50000.0 * 0.08 / 12, 2)
    assert abs(data["monthly_payment"] - expected) < 0.02


@pytest.mark.anyio
async def test_create_loan_missing_name(client: AsyncClient):
    """POST /lending without loan_name returns 422."""
    payload = _loan_payload()
    del payload["loan_name"]
    r = await client.post("/lending", json=payload)
    assert r.status_code == 422


@pytest.mark.anyio
async def test_create_loan_zero_principal(client: AsyncClient):
    """POST /lending with principal=0 returns 422."""
    r = await client.post("/lending", json=_loan_payload(principal=0))
    assert r.status_code == 422


@pytest.mark.anyio
async def test_create_loan_negative_principal(client: AsyncClient):
    """POST /lending with principal < 0 returns 422."""
    r = await client.post("/lending", json=_loan_payload(principal=-1000))
    assert r.status_code == 422


@pytest.mark.anyio
async def test_create_business_loan(client: AsyncClient):
    """POST /lending creates a business loan."""
    r = await client.post("/lending", json=_loan_payload(
        loan_name="Business Loan",
        loan_type="business",
        borrower_name="ACME Pty Ltd",
    ))
    assert r.status_code == 201
    assert r.json()["loan_type"] == "business"


# ── List ──────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_list_loans_empty(client: AsyncClient):
    """GET /lending returns empty list when no loans exist."""
    r = await client.get("/lending")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.anyio
async def test_list_loans_returns_created(client: AsyncClient):
    """GET /lending returns all created loans."""
    await _create_loan(client, loan_name="Loan A")
    await _create_loan(client, loan_name="Loan B", status="paid_off")
    r = await client.get("/lending")
    assert r.status_code == 200
    names = [l["loan_name"] for l in r.json()]
    assert "Loan A" in names
    assert "Loan B" in names


# ── Get by ID ─────────────────────────────────────────────────

@pytest.mark.anyio
async def test_get_loan_monthly_payment(client: AsyncClient):
    """GET /lending/{id} returns correct monthly_payment for $50k @ 8% 24mo P&I."""
    loan = await _create_loan(client)
    r = await client.get(f"/lending/{loan['id']}")
    assert r.status_code == 200
    data = r.json()
    # Formula: 50000 * 0.006667 / (1 - 1.006667^-24) ≈ 2261.36
    assert abs(data["monthly_payment"] - 2261.36) < 0.02


@pytest.mark.anyio
async def test_get_loan_404(client: AsyncClient):
    """GET /lending/99999 returns 404."""
    r = await client.get("/lending/99999")
    assert r.status_code == 404


# ── Update ────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_update_loan_name_and_status(client: AsyncClient):
    """PUT /lending/{id} updates loan_name and status."""
    loan = await _create_loan(client)
    r = await client.put(f"/lending/{loan['id']}", json={
        "loan_name": "Updated Loan Name",
        "status": "paid_off",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["loan_name"] == "Updated Loan Name"
    assert data["status"] == "paid_off"
    # Other fields unchanged
    assert data["principal"] == 50000.0


@pytest.mark.anyio
async def test_update_loan_404(client: AsyncClient):
    """PUT /lending/99999 returns 404."""
    r = await client.put("/lending/99999", json={"loan_name": "X"})
    assert r.status_code == 404


# ── Delete ────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_delete_loan(client: AsyncClient):
    """DELETE /lending/{id} removes the loan."""
    loan = await _create_loan(client)
    r = await client.delete(f"/lending/{loan['id']}")
    assert r.status_code == 204
    r2 = await client.get(f"/lending/{loan['id']}")
    assert r2.status_code == 404


@pytest.mark.anyio
async def test_delete_loan_404(client: AsyncClient):
    """DELETE /lending/99999 returns 404."""
    r = await client.delete("/lending/99999")
    assert r.status_code == 404


# ── Schedule ──────────────────────────────────────────────────

@pytest.mark.anyio
async def test_pi_schedule_length_and_closing_balance(client: AsyncClient):
    """P&I schedule has term_months rows and final closing_balance ≈ 0."""
    loan = await _create_loan(client, term_months=24)
    r = await client.get(f"/lending/{loan['id']}/schedule")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 24
    # Final closing balance should be approximately 0 (within $0.20 due to rounding)
    assert abs(rows[-1]["closing_balance"]) < 0.20


@pytest.mark.anyio
async def test_interest_only_schedule(client: AsyncClient):
    """Interest-only schedule has principal=0 and closing_balance unchanged."""
    loan = await _create_loan(client, repayment_type="interest_only", term_months=12)
    r = await client.get(f"/lending/{loan['id']}/schedule")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 12
    for row in rows:
        assert row["principal"] == 0.0
        assert abs(row["closing_balance"] - 50000.0) < 0.01


@pytest.mark.anyio
async def test_schedule_payment_dates_increment_monthly(client: AsyncClient):
    """Schedule payment_dates are one month apart from start_date."""
    loan = await _create_loan(client, start_date="2025-01-01T00:00:00", term_months=3)
    r = await client.get(f"/lending/{loan['id']}/schedule")
    assert r.status_code == 200
    rows = r.json()
    assert rows[0]["payment_date"] == "2025-02-01"
    assert rows[1]["payment_date"] == "2025-03-01"
    assert rows[2]["payment_date"] == "2025-04-01"


@pytest.mark.anyio
async def test_open_ended_loan_schedule_returns_404(client: AsyncClient):
    """GET /lending/{id}/schedule for open-ended loan returns 404."""
    loan = await _create_loan(client, term_months=None)
    r = await client.get(f"/lending/{loan['id']}/schedule")
    assert r.status_code == 404


@pytest.mark.anyio
async def test_open_ended_loan_monthly_payment_is_none(client: AsyncClient):
    """Open-ended loan has monthly_payment=None in response."""
    loan = await _create_loan(client, term_months=None)
    r = await client.get(f"/lending/{loan['id']}")
    assert r.status_code == 200
    assert r.json()["monthly_payment"] is None
    assert r.json()["total_interest"] is None


# ── Property-share loan with asset ───────────────────────────

@pytest.mark.anyio
async def test_property_share_loan_with_asset(client: AsyncClient):
    """Property-share loan includes nested asset in response."""
    asset_r = await client.post("/assets", json={
        "asset_name": "Test Property",
        "asset_type": "property",
        "address_suburb": "Kedron",
    })
    assert asset_r.status_code == 201
    asset_id = asset_r.json()["id"]

    loan = await _create_loan(client,
        loan_type="property_share",
        asset_id=asset_id,
        ownership_pct=50.0,
    )
    r = await client.get(f"/lending/{loan['id']}")
    assert r.status_code == 200
    data = r.json()
    assert data["loan_type"] == "property_share"
    assert data["asset_id"] == asset_id
    assert data["ownership_pct"] == 50.0
    assert data["asset"] is not None
    assert data["asset"]["asset_name"] == "Test Property"


# ── Transaction linking ────────────────────────────────────────

@pytest.mark.anyio
async def test_patch_transaction_link_as_disbursement(client: AsyncClient, db_session):
    """PATCH /transactions links a transaction as disbursement."""
    from sqlalchemy import text as sqla_text
    import hashlib

    acc_r = await client.post("/accounts", json={
        "account_number": "LEND-DISB-001",
        "account_name": "Test Bank",
        "bank_name": "TestBank",
        "account_type": "bank",
    })
    account_id = acc_r.json()["id"]

    cat_r = await client.get("/categories")
    expense_cats = [c for c in cat_r.json() if c["category_type"] == "Expense"]
    cat_id = expense_cats[0]["id"]

    tx_hash = hashlib.sha256(f"{account_id}|2025-06-01 00:00:00|Loan disbursement|50000.0".encode()).hexdigest()
    await db_session.execute(sqla_text(
        "INSERT INTO transactions (account_id, tx_date, tx_desc, tx_amount, tx_type, tx_hash, is_categorised) "
        "VALUES (:acc, '2025-06-01', 'Loan disbursement', 50000.0, 'Expense', :hash, 0)"
    ), {"acc": account_id, "hash": tx_hash})
    await db_session.commit()

    tx_r = await client.get(f"/transactions?account_id={account_id}")
    tx_id = tx_r.json()["items"][0]["id"]

    loan = await _create_loan(client)
    loan_id = loan["id"]

    patch_r = await client.patch(f"/transactions/{tx_id}", json={
        "category_id": cat_id,
        "lending_loan_id": loan_id,
        "lending_tx_type": "disbursement",
    })
    assert patch_r.status_code == 200
    data = patch_r.json()
    assert data["lending_loan_id"] == loan_id
    assert data["lending_tx_type"] == "disbursement"


@pytest.mark.anyio
async def test_patch_transaction_link_as_repayment(client: AsyncClient, db_session):
    """PATCH /transactions links a transaction as repayment."""
    from sqlalchemy import text as sqla_text
    import hashlib

    acc_r = await client.post("/accounts", json={
        "account_number": "LEND-REPAY-001",
        "account_name": "Test Bank 2",
        "bank_name": "TestBank",
        "account_type": "bank",
    })
    account_id = acc_r.json()["id"]

    cat_r = await client.get("/categories")
    income_cats = [c for c in cat_r.json() if c["category_type"] == "Income"]
    cat_id = income_cats[0]["id"]

    tx_hash = hashlib.sha256(f"{account_id}|2025-07-01 00:00:00|Repayment received|2261.36".encode()).hexdigest()
    await db_session.execute(sqla_text(
        "INSERT INTO transactions (account_id, tx_date, tx_desc, tx_amount, tx_type, tx_hash, is_categorised) "
        "VALUES (:acc, '2025-07-01', 'Repayment received', 2261.36, 'Income', :hash, 0)"
    ), {"acc": account_id, "hash": tx_hash})
    await db_session.commit()

    tx_r = await client.get(f"/transactions?account_id={account_id}")
    tx_id = tx_r.json()["items"][0]["id"]

    loan = await _create_loan(client)
    loan_id = loan["id"]

    patch_r = await client.patch(f"/transactions/{tx_id}", json={
        "category_id": cat_id,
        "lending_loan_id": loan_id,
        "lending_tx_type": "repayment",
    })
    assert patch_r.status_code == 200
    data = patch_r.json()
    assert data["lending_loan_id"] == loan_id
    assert data["lending_tx_type"] == "repayment"


@pytest.mark.anyio
async def test_get_loan_transactions(client: AsyncClient, db_session):
    """GET /lending/{id}/transactions returns linked transactions."""
    from sqlalchemy import text as sqla_text
    import hashlib

    acc_r = await client.post("/accounts", json={
        "account_number": "LEND-TXS-001",
        "account_name": "TX Test Bank",
        "bank_name": "TestBank",
        "account_type": "bank",
    })
    account_id = acc_r.json()["id"]

    cat_r = await client.get("/categories")
    income_cats = [c for c in cat_r.json() if c["category_type"] == "Income"]
    cat_id = income_cats[0]["id"]

    loan = await _create_loan(client)
    loan_id = loan["id"]

    tx_hash = hashlib.sha256(f"{account_id}|2025-08-01 00:00:00|Monthly repayment|2261.36".encode()).hexdigest()
    await db_session.execute(sqla_text(
        "INSERT INTO transactions (account_id, tx_date, tx_desc, tx_amount, tx_type, tx_hash, is_categorised, lending_loan_id, lending_tx_type) "
        "VALUES (:acc, '2025-08-01', 'Monthly repayment', 2261.36, 'Income', :hash, 1, :loan, 'repayment')"
    ), {"acc": account_id, "hash": tx_hash, "loan": loan_id})
    await db_session.commit()

    r = await client.get(f"/lending/{loan_id}/transactions")
    assert r.status_code == 200
    txs = r.json()
    assert len(txs) == 1
    assert txs[0]["lending_tx_type"] == "repayment"
    assert txs[0]["tx_amount"] == 2261.36


@pytest.mark.anyio
async def test_unlink_transaction_via_sentinel(client: AsyncClient, db_session):
    """PATCH with lending_loan_id=-1 unlinks the transaction."""
    from sqlalchemy import text as sqla_text
    import hashlib

    acc_r = await client.post("/accounts", json={
        "account_number": "LEND-UNLINK-001",
        "account_name": "Unlink Bank",
        "bank_name": "TestBank",
        "account_type": "bank",
    })
    account_id = acc_r.json()["id"]

    cat_r = await client.get("/categories")
    income_cats = [c for c in cat_r.json() if c["category_type"] == "Income"]
    cat_id = income_cats[0]["id"]

    loan = await _create_loan(client)
    loan_id = loan["id"]

    tx_hash = hashlib.sha256(f"{account_id}|2025-09-01 00:00:00|Payment|1000.0".encode()).hexdigest()
    await db_session.execute(sqla_text(
        "INSERT INTO transactions (account_id, tx_date, tx_desc, tx_amount, tx_type, tx_hash, is_categorised, lending_loan_id, lending_tx_type) "
        "VALUES (:acc, '2025-09-01', 'Payment', 1000.0, 'Income', :hash, 1, :loan, 'repayment')"
    ), {"acc": account_id, "hash": tx_hash, "loan": loan_id})
    await db_session.commit()

    tx_r = await client.get(f"/transactions?account_id={account_id}")
    tx_id = tx_r.json()["items"][0]["id"]

    patch_r = await client.patch(f"/transactions/{tx_id}", json={
        "lending_loan_id": -1,
    })
    assert patch_r.status_code == 200
    data = patch_r.json()
    assert data["lending_loan_id"] is None
    assert data["lending_tx_type"] is None


@pytest.mark.anyio
async def test_delete_loan_unlinks_transactions(client: AsyncClient, db_session):
    """DELETE /lending/{id} sets lending_loan_id=null on linked transactions (SET NULL)."""
    from sqlalchemy import text as sqla_text
    import hashlib

    acc_r = await client.post("/accounts", json={
        "account_number": "LEND-DEL-001",
        "account_name": "Delete Test Bank",
        "bank_name": "TestBank",
        "account_type": "bank",
    })
    account_id = acc_r.json()["id"]

    loan = await _create_loan(client)
    loan_id = loan["id"]

    tx_hash = hashlib.sha256(f"{account_id}|2025-10-01 00:00:00|Repayment|500.0".encode()).hexdigest()
    await db_session.execute(sqla_text(
        "INSERT INTO transactions (account_id, tx_date, tx_desc, tx_amount, tx_type, tx_hash, is_categorised, lending_loan_id, lending_tx_type) "
        "VALUES (:acc, '2025-10-01', 'Repayment', 500.0, 'Income', :hash, 1, :loan, 'repayment')"
    ), {"acc": account_id, "hash": tx_hash, "loan": loan_id})
    await db_session.commit()

    del_r = await client.delete(f"/lending/{loan_id}")
    assert del_r.status_code == 204

    tx_r = await client.get(f"/transactions?account_id={account_id}")
    tx = tx_r.json()["items"][0]
    assert tx["lending_loan_id"] is None


# ── Schedule enrichment ───────────────────────────────────────

@pytest.mark.anyio
async def test_schedule_enrichment_with_repayment_tx(client: AsyncClient, db_session):
    """Schedule row is enriched with actual_payment when repayment tx within 5 days."""
    from sqlalchemy import text as sqla_text
    import hashlib

    acc_r = await client.post("/accounts", json={
        "account_number": "LEND-SCHED-001",
        "account_name": "Schedule Bank",
        "bank_name": "TestBank",
        "account_type": "bank",
    })
    account_id = acc_r.json()["id"]

    loan = await _create_loan(client, start_date="2025-01-01T00:00:00", term_months=3)
    loan_id = loan["id"]

    # Payment on 2025-02-01 (period 1) — exact date match
    tx_hash = hashlib.sha256(f"{account_id}|2025-02-01 00:00:00|Feb repayment|2261.36".encode()).hexdigest()
    await db_session.execute(sqla_text(
        "INSERT INTO transactions (account_id, tx_date, tx_desc, tx_amount, tx_type, tx_hash, is_categorised, lending_loan_id, lending_tx_type) "
        "VALUES (:acc, '2025-02-01', 'Feb repayment', 2261.36, 'Income', :hash, 1, :loan, 'repayment')"
    ), {"acc": account_id, "hash": tx_hash, "loan": loan_id})
    await db_session.commit()

    r = await client.get(f"/lending/{loan_id}/schedule")
    assert r.status_code == 200
    rows = r.json()
    assert rows[0]["actual_payment"] == 2261.36
    assert rows[0]["actual_tx_id"] is not None
    # Other periods not enriched
    assert rows[1]["actual_payment"] is None
    assert rows[2]["actual_payment"] is None


# ── Portfolio summary ─────────────────────────────────────────

@pytest.mark.anyio
async def test_portfolio_summary_empty(client: AsyncClient):
    """GET /lending/summary returns zeros when no loans exist."""
    r = await client.get("/lending/summary")
    assert r.status_code == 200
    data = r.json()
    assert data["total_capital_deployed"] == 0.0
    assert data["count_active"] == 0
    assert data["weighted_avg_rate"] is None


@pytest.mark.anyio
async def test_portfolio_summary_total_capital(client: AsyncClient):
    """Portfolio summary: total_capital_deployed sums active principals."""
    await _create_loan(client, loan_name="Loan 1", principal=30000.0, status="active")
    await _create_loan(client, loan_name="Loan 2", principal=20000.0, status="active")
    await _create_loan(client, loan_name="Loan 3", principal=10000.0, status="paid_off")

    r = await client.get("/lending/summary")
    assert r.status_code == 200
    data = r.json()
    assert data["total_capital_deployed"] == 50000.0
    assert data["count_active"] == 2
    assert data["count_paid_off"] == 1
    assert data["count_defaulted"] == 0


@pytest.mark.anyio
async def test_portfolio_summary_weighted_avg_rate(client: AsyncClient):
    """Portfolio summary: weighted_avg_rate is correct."""
    # Loan A: $30k @ 6% — weight contribution = 30000 * 6 = 180000
    # Loan B: $20k @ 9% — weight contribution = 20000 * 9 = 180000
    # Weighted avg = 360000 / 50000 = 7.2%
    await _create_loan(client, loan_name="Rate A", principal=30000.0, interest_rate=6.0, status="active")
    await _create_loan(client, loan_name="Rate B", principal=20000.0, interest_rate=9.0, status="active")

    r = await client.get("/lending/summary")
    assert r.status_code == 200
    data = r.json()
    assert abs(data["weighted_avg_rate"] - 7.2) < 0.01


# ── New fields: first_payment_date, manual disbursement ────────

@pytest.mark.anyio
async def test_create_loan_with_first_payment_date(client: AsyncClient):
    r = await client.post("/lending", json={
        "loan_name": "FPD Loan",
        "principal": 10000,
        "interest_rate": 5.0,
        "start_date": "2025-01-01T00:00:00",
        "term_months": 12,
        "first_payment_date": "2025-03-01T00:00:00",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["first_payment_date"] is not None
    assert "2025-03-01" in data["first_payment_date"]


@pytest.mark.anyio
async def test_schedule_uses_first_payment_date_as_anchor(client: AsyncClient):
    r = await client.post("/lending", json={
        "loan_name": "Anchor Loan",
        "principal": 10000,
        "interest_rate": 5.0,
        "start_date": "2025-01-01T00:00:00",
        "term_months": 3,
        "first_payment_date": "2025-03-01T00:00:00",
    })
    assert r.status_code == 201
    loan_id = r.json()["id"]

    sched = await client.get(f"/lending/{loan_id}/schedule")
    assert sched.status_code == 200
    rows = sched.json()
    assert len(rows) == 3
    assert rows[0]["payment_date"] == "2025-03-01"
    assert rows[1]["payment_date"] == "2025-04-01"
    assert rows[2]["payment_date"] == "2025-05-01"


@pytest.mark.anyio
async def test_schedule_default_anchor_without_first_payment_date(client: AsyncClient):
    r = await client.post("/lending", json={
        "loan_name": "Default Anchor Loan",
        "principal": 10000,
        "interest_rate": 5.0,
        "start_date": "2025-01-01T00:00:00",
        "term_months": 2,
    })
    loan_id = r.json()["id"]
    sched = await client.get(f"/lending/{loan_id}/schedule")
    rows = sched.json()
    # Default: start_date + 1 month for period 1
    assert rows[0]["payment_date"] == "2025-02-01"
    assert rows[1]["payment_date"] == "2025-03-01"


@pytest.mark.anyio
async def test_manual_disbursement_amount_shown_in_response(client: AsyncClient):
    r = await client.post("/lending", json={
        "loan_name": "Manual Disb Loan",
        "principal": 5000,
        "interest_rate": 6.0,
        "start_date": "2025-01-01T00:00:00",
        "manual_disbursement_date": "2025-01-05T00:00:00",
        "manual_disbursement_amount": 5000,
    })
    assert r.status_code == 201
    data = r.json()
    assert data["disbursed_amount"] == 5000.0
    assert data["manual_disbursement_amount"] == 5000.0
    assert data["manual_disbursement_date"] is not None


@pytest.mark.anyio
async def test_create_loan_new_fields_null_by_default(client: AsyncClient):
    r = await client.post("/lending", json={
        "loan_name": "Minimal Loan",
        "principal": 1000,
        "interest_rate": 3.0,
        "start_date": "2025-06-01T00:00:00",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["first_payment_date"] is None
    assert data["manual_disbursement_date"] is None
    assert data["manual_disbursement_amount"] is None
