"""
Tests for the /loans endpoints.

Covers:
- GET /loans returns only home_loan accounts
- GET /loans/{id}/summary — balance, interest paid, principal, percent_paid
- GET /loans/{id}/history — monthly breakdown
- Projected payoff for P&I loans
- Interest-only loans have no projected payoff date
- 404 for non-loan accounts
"""

import os
import pytest
from httpx import AsyncClient

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


async def _upload_loan(client, fixture="macquarie_loan_sample.csv"):
    with open(os.path.join(FIXTURES_DIR, fixture), "rb") as f:
        r = await client.post(
            "/upload",
            files={"file": (fixture, f, "text/csv")},
        )
    assert r.status_code == 200, r.text
    return r.json()


async def _get_loan_id(client) -> int:
    r = await client.get("/loans")
    assert r.status_code == 200
    assert len(r.json()) > 0, "No loans found — upload fixture first"
    return r.json()[0]["account_id"]


# ── List loans ─────────────────────────────────────────────────

@pytest.mark.anyio
async def test_list_loans_empty(client: AsyncClient):
    """GET /loans returns empty list when no loan accounts exist."""
    r = await client.get("/loans")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.anyio
async def test_list_loans_after_upload(client: AsyncClient):
    """GET /loans returns loan accounts after CSV upload."""
    await _upload_loan(client)
    r = await client.get("/loans")
    assert r.status_code == 200
    assert len(r.json()) >= 1
    assert r.json()[0]["account_name"] == "Greenfield"


@pytest.mark.anyio
async def test_list_loans_excludes_bank_accounts(client: AsyncClient):
    """GET /loans does not include bank-type accounts."""
    # Create a bank account
    await client.post("/accounts", json={
        "account_number": "BANK-001", "account_name": "My Bank",
        "bank_name": "Westpac", "account_type": "bank",
    })
    r = await client.get("/loans")
    loan_ids = [l["account_id"] for l in r.json()]
    # Verify bank account is not in loans
    accounts = await client.get("/accounts")
    bank_id = next(a["id"] for a in accounts.json() if a["account_number"] == "BANK-001")
    assert bank_id not in loan_ids


# ── Loan summary ───────────────────────────────────────────────

@pytest.mark.anyio
async def test_loan_summary_has_correct_fields(client: AsyncClient):
    """GET /loans/{id}/summary returns all required fields."""
    await _upload_loan(client)
    loan_id = await _get_loan_id(client)
    r = await client.get(f"/loans/{loan_id}/summary")
    assert r.status_code == 200
    data = r.json()
    assert "account_id" in data
    assert "account_name" in data
    assert "current_balance" in data
    assert "total_interest_paid" in data
    assert "total_principal_paid" in data
    assert "percent_paid" in data


@pytest.mark.anyio
async def test_loan_summary_current_balance(client: AsyncClient):
    """Loan summary current_balance = abs of latest transaction balance."""
    await _upload_loan(client)
    loan_id = await _get_loan_id(client)
    r = await client.get(f"/loans/{loan_id}/summary")
    data = r.json()
    # From fixture: latest balance is -455621.68 → current_balance ≈ 455621
    assert data["current_balance"] == pytest.approx(455621.68, abs=2.0)


@pytest.mark.anyio
async def test_loan_summary_interest_paid(client: AsyncClient):
    """total_interest_paid is sum of interest transactions (requires seeded categories + rules)."""
    await _upload_loan(client)
    loan_id = await _get_loan_id(client)
    r = await client.get(f"/loans/{loan_id}/summary")
    data = r.json()
    # total_interest_paid should be >= 0
    assert data["total_interest_paid"] >= 0


@pytest.mark.anyio
async def test_loan_summary_404_for_bank_account(client: AsyncClient):
    """GET /loans/{id}/summary returns 404 for a non-loan account."""
    r = await client.post("/accounts", json={
        "account_number": "BANK-TEST", "account_name": "Bank",
        "bank_name": "Westpac", "account_type": "bank",
    })
    bank_id = r.json()["id"]
    r2 = await client.get(f"/loans/{bank_id}/summary")
    assert r2.status_code == 404


@pytest.mark.anyio
async def test_loan_summary_no_projected_payoff_without_rate(client: AsyncClient):
    """projected_payoff_date is None when no interest rate is set."""
    await _upload_loan(client)
    loan_id = await _get_loan_id(client)
    r = await client.get(f"/loans/{loan_id}/summary")
    # No rate set on account → no projected payoff
    assert r.json()["projected_payoff_date"] is None


@pytest.mark.anyio
async def test_loan_summary_projected_payoff_with_rate(client: AsyncClient):
    """projected_payoff_date is set when interest rate is configured on the account."""
    await _upload_loan(client)
    loan_id = await _get_loan_id(client)
    # Set interest rate + repayment type
    await client.put(f"/accounts/{loan_id}", json={
        "loan_interest_rate": 5.84,
        "loan_repayment_type": "principal_and_interest",
        "loan_term_years": 30,
    })
    r = await client.get(f"/loans/{loan_id}/summary")
    data = r.json()
    assert data["projected_payoff_date"] is not None
    # Should be a date string
    assert len(data["projected_payoff_date"]) == 10  # YYYY-MM-DD


@pytest.mark.anyio
async def test_loan_summary_interest_only_no_payoff(client: AsyncClient):
    """Interest-only loans have no projected payoff date."""
    await _upload_loan(client)
    loan_id = await _get_loan_id(client)
    await client.put(f"/accounts/{loan_id}", json={
        "loan_interest_rate": 5.84,
        "loan_repayment_type": "interest_only",
    })
    r = await client.get(f"/loans/{loan_id}/summary")
    assert r.json()["projected_payoff_date"] is None
    assert r.json()["loan_repayment_type"] == "interest_only"


# ── Loan history ───────────────────────────────────────────────

@pytest.mark.anyio
async def test_loan_history_returns_months(client: AsyncClient):
    """GET /loans/{id}/history returns monthly rows."""
    await _upload_loan(client)
    loan_id = await _get_loan_id(client)
    r = await client.get(f"/loans/{loan_id}/history")
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 1
    # Verify row structure
    row = data[0]
    assert "month" in row
    assert "payment" in row
    assert "interest" in row
    assert "principal" in row
    assert "balance" in row


@pytest.mark.anyio
async def test_loan_history_month_format(client: AsyncClient):
    """History month keys are in YYYY-MM format."""
    await _upload_loan(client)
    loan_id = await _get_loan_id(client)
    r = await client.get(f"/loans/{loan_id}/history")
    for row in r.json():
        assert len(row["month"]) == 7
        assert row["month"][4] == "-"


@pytest.mark.anyio
async def test_loan_history_principal_calculation(client: AsyncClient):
    """principal = payment - interest per month."""
    await _upload_loan(client)
    loan_id = await _get_loan_id(client)
    r = await client.get(f"/loans/{loan_id}/history")
    for row in r.json():
        expected = round(row["payment"] - row["interest"], 2)
        assert row["principal"] == pytest.approx(expected, abs=0.01)


@pytest.mark.anyio
async def test_loan_history_404_for_bank_account(client: AsyncClient):
    """GET /loans/{id}/history returns 404 for a non-loan account."""
    r = await client.post("/accounts", json={
        "account_number": "BANK-HIST", "account_name": "Bank",
        "bank_name": "Westpac", "account_type": "bank",
    })
    bank_id = r.json()["id"]
    r2 = await client.get(f"/loans/{bank_id}/history")
    assert r2.status_code == 404


# ── Asset linkage ──────────────────────────────────────────────

@pytest.mark.anyio
async def test_loan_summary_with_linked_asset(client: AsyncClient):
    """Loan summary includes asset details when asset_id is set."""
    await _upload_loan(client)
    loan_id = await _get_loan_id(client)

    # Create an asset and link it
    asset_r = await client.post("/assets", json={
        "asset_name": "Boondall Property",
        "asset_type": "property",
        "current_value": 680000,
        "purchase_price": 472050,
    })
    asset_id = asset_r.json()["id"]
    await client.put(f"/accounts/{loan_id}", json={"asset_id": asset_id})

    r = await client.get(f"/loans/{loan_id}/summary")
    data = r.json()
    assert data["asset_id"] == asset_id
    assert data["asset"] is not None
    assert data["asset"]["asset_name"] == "Boondall Property"
