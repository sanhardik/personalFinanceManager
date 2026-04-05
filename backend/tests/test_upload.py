"""
Tests for the CSV upload endpoint and accounts endpoints.

Uses the test MariaDB database (port 3307).
"""

import os
import pytest

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_fixture(name):
    with open(os.path.join(FIXTURES_DIR, name)) as f:
        return f.read()


# ── GET /upload/banks ────────────────────────────────────────

@pytest.mark.anyio
async def test_list_supported_banks(client):
    """GET /upload/banks should list supported banks."""
    response = await client.get("/upload/banks")
    assert response.status_code == 200
    banks = response.json()
    assert "Westpac" in banks


# ── POST /upload ─────────────────────────────────────────────

@pytest.mark.anyio
async def test_upload_westpac_csv(client):
    """Uploading a valid Westpac CSV should insert transactions."""
    csv_content = _load_fixture("westpac_sample.csv")

    response = await client.post(
        "/upload",
        files={"file": ("export.csv", csv_content.encode(), "text/csv")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["bank_name"] == "Westpac"
    assert data["inserted"] > 0
    assert data["total_rows"] > 0
    assert len(data["accounts_found"]) >= 1


@pytest.mark.anyio
async def test_upload_duplicate_detection(client):
    """Uploading the same CSV twice should detect duplicates."""
    csv_content = _load_fixture("westpac_sample.csv")

    # First upload
    resp1 = await client.post(
        "/upload",
        files={"file": ("export.csv", csv_content.encode(), "text/csv")},
    )
    first_inserted = resp1.json()["inserted"]

    # Second upload — same file
    resp2 = await client.post(
        "/upload",
        files={"file": ("export.csv", csv_content.encode(), "text/csv")},
    )
    data2 = resp2.json()
    assert data2["duplicates"] == first_inserted
    assert data2["inserted"] == 0


@pytest.mark.anyio
async def test_upload_non_csv_rejected(client):
    """Uploading a non-CSV file should return 400."""
    response = await client.post(
        "/upload",
        files={"file": ("data.txt", b"not a csv", "text/plain")},
    )
    assert response.status_code == 400


@pytest.mark.anyio
async def test_upload_unknown_bank_rejected(client):
    """A CSV with unrecognised headers should return 400."""
    csv_content = "Date,Amount,Description\n2026-01-01,100,Test"
    response = await client.post(
        "/upload",
        files={"file": ("unknown.csv", csv_content.encode(), "text/csv")},
    )
    assert response.status_code == 400


@pytest.mark.anyio
async def test_upload_empty_csv_rejected(client):
    """An empty CSV should return 400."""
    response = await client.post(
        "/upload",
        files={"file": ("empty.csv", b"", "text/csv")},
    )
    assert response.status_code == 400


# ── GET /accounts ────────────────────────────────────────────

@pytest.mark.anyio
async def test_list_accounts_after_upload(client):
    """Accounts should be auto-created after CSV upload."""
    # Upload first
    csv_content = _load_fixture("westpac_sample.csv")
    await client.post(
        "/upload",
        files={"file": ("export.csv", csv_content.encode(), "text/csv")},
    )

    response = await client.get("/accounts")
    assert response.status_code == 200
    accounts = response.json()
    assert len(accounts) >= 1
    # Check the bank account was created
    numbers = [a["account_number"] for a in accounts]
    assert "732289824046" in numbers


@pytest.mark.anyio
async def test_account_type_detection(client):
    """Short account numbers should be detected as credit_card."""
    csv_content = (
        "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n"
        '1912,27/03/2026,"COLES SCHOFIELDS",42.39,,0.00,OTHER,\n'
        '732289824046,27/03/2026,"PAYMENT TO Someone",100.00,,5000.00,PAYMENT,'
    )
    await client.post(
        "/upload",
        files={"file": ("test.csv", csv_content.encode(), "text/csv")},
    )

    response = await client.get("/accounts")
    accounts = {a["account_number"]: a for a in response.json()}
    if "1912" in accounts:
        assert accounts["1912"]["account_type"] == "credit_card"
    if "732289824046" in accounts:
        assert accounts["732289824046"]["account_type"] == "bank"


@pytest.mark.anyio
async def test_create_account_manually(client):
    """POST /accounts should create an account manually."""
    response = await client.post(
        "/accounts",
        json={
            "account_number": "HOMELOAN001",
            "account_name": "My Home Loan",
            "bank_name": "NAB",
            "account_type": "home_loan",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["account_type"] == "home_loan"
    assert data["bank_name"] == "NAB"


@pytest.mark.anyio
async def test_account_summary_endpoint(client):
    """GET /accounts/summary should return enriched account data."""
    # Upload some data first
    csv_content = _load_fixture("westpac_sample.csv")
    await client.post(
        "/upload",
        files={"file": ("export.csv", csv_content.encode(), "text/csv")},
    )

    response = await client.get("/accounts/summary")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    # Check summary fields exist
    acc = data[0]
    assert "transaction_count" in acc
    assert "latest_balance" in acc
    assert "latest_tx_date" in acc


# ── GET /transactions ────────────────────────────────────────

@pytest.mark.anyio
async def test_list_transactions_after_upload(client):
    """Transactions should be queryable after CSV upload."""
    csv_content = _load_fixture("westpac_sample.csv")
    await client.post(
        "/upload",
        files={"file": ("export.csv", csv_content.encode(), "text/csv")},
    )

    response = await client.get("/transactions")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
    assert "pages" in data
    assert data["total"] > 0


@pytest.mark.anyio
async def test_transactions_pagination(client):
    """Transactions should support pagination."""
    csv_content = _load_fixture("westpac_sample.csv")
    await client.post(
        "/upload",
        files={"file": ("export.csv", csv_content.encode(), "text/csv")},
    )

    response = await client.get("/transactions", params={"per_page": 5, "page": 1})
    data = response.json()
    assert len(data["items"]) <= 5
    assert data["page"] == 1


@pytest.mark.anyio
async def test_transactions_search(client):
    """Transactions should be filterable by search term."""
    csv_content = _load_fixture("westpac_sample.csv")
    await client.post(
        "/upload",
        files={"file": ("export.csv", csv_content.encode(), "text/csv")},
    )

    response = await client.get("/transactions", params={"search": "PAYMENT"})
    data = response.json()
    # All results should contain "PAYMENT" in description
    for tx in data["items"]:
        assert "PAYMENT" in tx["tx_desc"].upper()
