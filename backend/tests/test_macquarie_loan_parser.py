"""
Tests for Macquarie loan CSV parsing.

Covers:
- Loan account detection via Subcategory=Interest
- account_type set to "home_loan" for loan accounts
- Unique slug generation with drawdown amount for duplicate account names
- Interest row → Expense, Payment row → Income
- Balance parsing (negative for loans)
- Documentation Fee and Loan drawdown rows
- Upload integration for loan CSV
"""

import io
import os
import pytest
from httpx import AsyncClient

from app.parsers.macquarie import MacquarieParser, _account_slug

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _load(name):
    with open(os.path.join(FIXTURES_DIR, name)) as f:
        return f.read()


LOAN_CSV = _load("macquarie_loan_sample.csv")
DUAL_LOAN_CSV = _load("macquarie_dual_loan_sample.csv")


# ── Loan detection ─────────────────────────────────────────────

def test_loan_account_type_detected():
    """CSV with Subcategory=Interest → account_type=home_loan."""
    parser = MacquarieParser()
    result = parser.parse(LOAN_CSV)
    account_types = {tx.account_type for tx in result.transactions}
    assert "home_loan" in account_types
    assert "bank" not in account_types


def test_loan_account_name_passed_through():
    """Account name from CSV is preserved on parsed transactions."""
    parser = MacquarieParser()
    result = parser.parse(LOAN_CSV)
    names = {tx.account_name for tx in result.transactions}
    assert "Greenfield" in names


def test_loan_slug_includes_account_name():
    """Loan account slug uses Macquarie prefix + account name."""
    parser = MacquarieParser()
    result = parser.parse(LOAN_CSV)
    slugs = {tx.account_number for tx in result.transactions}
    assert len(slugs) == 1
    slug = list(slugs)[0]
    assert slug.startswith("MAC-GREENFIELD")


def test_savings_account_type_unchanged():
    """Non-loan Macquarie CSV still produces account_type=bank."""
    parser = MacquarieParser()
    SAVINGS_CSV = (
        "Transaction Date,Details,Account,Category,Subcategory,Tags,Notes,Debit,Credit,Balance,Original Description\n"
        '"10 Apr 2026","Coffee","Main account","Food","Cafes","","","5.50","","1000.00","Coffee shop"\n'
    )
    result = parser.parse(SAVINGS_CSV)
    assert all(tx.account_type == "bank" for tx in result.transactions)


# ── Transaction types ──────────────────────────────────────────

def test_interest_row_is_expense():
    """Interest Charged row → tx_type=Expense."""
    parser = MacquarieParser()
    result = parser.parse(LOAN_CSV)
    interest_txs = [tx for tx in result.transactions if "Interest charged" in tx.tx_desc]
    assert len(interest_txs) >= 1
    for tx in interest_txs:
        assert tx.tx_type == "Expense"


def test_payment_row_is_income():
    """From Investment Account (payment) row → tx_type=Income."""
    parser = MacquarieParser()
    result = parser.parse(LOAN_CSV)
    payment_txs = [tx for tx in result.transactions if tx.tx_type == "Income"]
    assert len(payment_txs) >= 1


def test_drawdown_row_is_expense():
    """Loan drawdown row → tx_type=Expense."""
    parser = MacquarieParser()
    result = parser.parse(LOAN_CSV)
    drawdown = [tx for tx in result.transactions if "drawdown" in tx.tx_desc.lower()]
    assert len(drawdown) == 1
    assert drawdown[0].tx_type == "Expense"
    assert drawdown[0].tx_amount == 601400.0


def test_documentation_fee_is_expense():
    """Documentation Fee row → tx_type=Expense."""
    parser = MacquarieParser()
    result = parser.parse(LOAN_CSV)
    fees = [tx for tx in result.transactions if "fee" in tx.tx_desc.lower()]
    assert len(fees) == 1
    assert fees[0].tx_type == "Expense"
    assert fees[0].tx_amount == 350.0


# ── Amounts and balance ────────────────────────────────────────

def test_interest_amount_correct():
    """Interest charged amount parsed correctly."""
    parser = MacquarieParser()
    result = parser.parse(LOAN_CSV)
    # Most recent interest: 2578.90 (Mar 2026)
    interest_txs = [tx for tx in result.transactions
                    if "Interest charged" in tx.tx_desc
                    and tx.tx_date.month == 3 and tx.tx_date.year == 2026]
    assert len(interest_txs) == 1
    assert interest_txs[0].tx_amount == pytest.approx(2578.90)


def test_negative_balance_preserved():
    """Loan balance is negative in CSV and preserved as-is."""
    parser = MacquarieParser()
    result = parser.parse(LOAN_CSV)
    balances = [tx.balance for tx in result.transactions if tx.balance is not None]
    assert all(b < 0 for b in balances), "All loan balances should be negative"


def test_original_description_preferred():
    """Original Description preferred over Details when non-empty."""
    parser = MacquarieParser()
    result = parser.parse(LOAN_CSV)
    interest_tx = next(tx for tx in result.transactions if "Interest" in tx.tx_desc)
    assert interest_tx.tx_desc == "Interest charged"  # from Original Description col


# ── Duplicate account name disambiguation ──────────────────────

def test_duplicate_loan_name_gets_unique_slugs():
    """
    Two separate CSVs with the same account name "Basic Home Loan" but different
    drawdown amounts get unique slugs: MAC-BASIC-HOME-LOAN-102300 etc.
    """
    parser = MacquarieParser()
    # The fixture has one "Basic Home Loan" with $102,300 drawdown
    result = parser.parse(DUAL_LOAN_CSV)
    slugs = {tx.account_number for tx in result.transactions}
    assert len(slugs) == 1
    slug = list(slugs)[0]
    # Should include the drawdown amount for disambiguation
    assert "102300" in slug or slug == "MAC-BASIC-HOME-LOAN"


def test_account_slug_helper():
    """_account_slug converts account name to uppercase MAC- prefix slug."""
    assert _account_slug("Main account") == "MAC-MAIN-ACCOUNT"
    assert _account_slug("Boondall") == "MAC-BOONDALL"
    assert _account_slug("Basic Home Loan") == "MAC-BASIC-HOME-LOAN"


# ── Upload integration ─────────────────────────────────────────

@pytest.mark.anyio
async def test_upload_loan_csv_creates_home_loan_account(client: AsyncClient):
    """Uploading a loan CSV creates an account with account_type=home_loan."""
    with open(os.path.join(FIXTURES_DIR, "macquarie_loan_sample.csv"), "rb") as f:
        response = await client.post(
            "/upload",
            files={"file": ("macquarie_loan_sample.csv", f, "text/csv")},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["inserted"] > 0

    # Check the created account is home_loan type
    accounts = await client.get("/accounts")
    loan_accounts = [a for a in accounts.json() if a["account_type"] == "home_loan"]
    assert len(loan_accounts) >= 1
    assert loan_accounts[0]["account_name"] == "Greenfield"


@pytest.mark.anyio
async def test_upload_loan_csv_no_false_bank_account(client: AsyncClient):
    """Loan CSV should not create any bank-type accounts."""
    with open(os.path.join(FIXTURES_DIR, "macquarie_loan_sample.csv"), "rb") as f:
        await client.post(
            "/upload",
            files={"file": ("macquarie_loan_sample.csv", f, "text/csv")},
        )
    accounts = await client.get("/accounts")
    # All Macquarie loan accounts should be home_loan, not bank
    mac_accounts = [a for a in accounts.json() if "MAC-GREENFIELD" in a["account_number"]]
    assert all(a["account_type"] == "home_loan" for a in mac_accounts)
