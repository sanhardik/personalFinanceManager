"""
Unit tests for the Macquarie Bank CSV parser.

Tests cover:
- Header detection (Macquarie vs other banks)
- Parser registry auto-detection
- Expense (Debit) and income (Credit) parsing
- Date format DD Mon YYYY (4-digit year)
- Balance parsing
- Account number derivation from account name slug
- Original Description preferred over Details
- Category + subcategory concatenation
- Empty/invalid row handling
- Upload integration via POST /upload
"""

import os
import pytest

from app.parsers.macquarie import MacquarieParser, _account_slug
from app.parsers.registry import detect_parser

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_fixture(name):
    with open(os.path.join(FIXTURES_DIR, name)) as f:
        return f.read()


# Minimal Macquarie CSV for unit tests
SAMPLE_MAC_CSV = """\
Transaction Date,Details,Account,Category,Subcategory,Tags,Notes,Debit,Credit,Balance,Original Description
"10 Apr 2026","To Investment Account - Internal Transfer Receipt number: ON0000198460347","Main account","Financial","Transfers","","","5000","","28244.77","To linked account xx2733 - Internal transfer"
"08 Apr 2026","From CBA (Quickstepz)","Main account","Financial","Transfers","","","","518.2","33244.77","From CBA - Quickstepz"
"26 Mar 2026","To Jetstar Airways Pty Ltd - $552 Receipt number: OPP001","Main account","Travel","Flights","","","552","","31931.87","To Jetstar Airways Pty Ltd - $552 - Booking Reference: KUK"
"31 Mar 2026","Payment","Main account","Income","Interest","tax","","","51.4","32726.57","Payment"
"18 Mar 2026","To Account Xx2725","Offset account","Financial","Direct Debits","","","573.77","","20669.87","to account xx2725"
"""


# ── Header detection ──────────────────────────────────────────

def test_macquarie_parser_detects_header():
    """MacquarieParser.can_parse() returns True for a real Macquarie header."""
    parser = MacquarieParser()
    header = "Transaction Date,Details,Account,Category,Subcategory,Tags,Notes,Debit,Credit,Balance,Original Description"
    assert parser.can_parse(header) is True


def test_macquarie_parser_rejects_westpac_header():
    """MacquarieParser.can_parse() returns False for a Westpac header."""
    parser = MacquarieParser()
    header = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial"
    assert parser.can_parse(header) is False


def test_macquarie_parser_rejects_nab_header():
    """MacquarieParser.can_parse() returns False for a NAB header."""
    parser = MacquarieParser()
    header = "Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On"
    assert parser.can_parse(header) is False


def test_macquarie_parser_rejects_unknown_header():
    """MacquarieParser.can_parse() returns False for an unknown header."""
    parser = MacquarieParser()
    assert parser.can_parse("col1,col2,col3") is False


def test_registry_detects_macquarie():
    """detect_parser() returns MacquarieParser for a Macquarie header."""
    header = "Transaction Date,Details,Account,Category,Subcategory,Tags,Notes,Debit,Credit,Balance,Original Description"
    parser = detect_parser(header)
    assert parser is not None
    assert parser.bank_name == "Macquarie"


def test_registry_still_detects_westpac_and_nab():
    """Adding Macquarie parser doesn't break Westpac or NAB detection."""
    westpac_header = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial"
    nab_header = "Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On"
    assert detect_parser(westpac_header).bank_name == "Westpac"
    assert detect_parser(nab_header).bank_name == "NAB"


# ── Account slug ──────────────────────────────────────────────

def test_account_slug_main_account():
    """'Main account' slugifies to 'MAC-MAIN-ACCOUNT'."""
    assert _account_slug("Main account") == "MAC-MAIN-ACCOUNT"


def test_account_slug_offset_account():
    """'Offset account' slugifies to 'MAC-OFFSET-ACCOUNT'."""
    assert _account_slug("Offset account") == "MAC-OFFSET-ACCOUNT"


def test_account_slug_special_chars():
    """Special characters are collapsed to hyphens."""
    slug = _account_slug("Savings Account #1")
    assert slug.startswith("MAC-")
    assert "#" not in slug


# ── Parsing ───────────────────────────────────────────────────

def test_parse_row_count():
    """Parser returns the correct number of transactions."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    assert result.row_count == 5
    assert len(result.transactions) == 5
    assert result.skipped_count == 0


def test_parse_expense_transaction():
    """Debit column → Expense type, stored as positive tx_amount."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    expenses = [t for t in result.transactions if t.tx_type == "Expense"]
    assert len(expenses) == 3  # 5000, 552, 573.77
    for tx in expenses:
        assert tx.tx_amount > 0


def test_parse_income_transaction():
    """Credit column → Income type, stored as positive tx_amount."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    income = [t for t in result.transactions if t.tx_type == "Income"]
    assert len(income) == 2  # 518.2, 51.4
    for tx in income:
        assert tx.tx_amount > 0


def test_parse_expense_amount():
    """Debit amount is parsed correctly."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    investment = next(t for t in result.transactions if t.tx_amount == 5000.0)
    assert investment.tx_type == "Expense"


def test_parse_income_amount():
    """Credit amount is parsed correctly."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    cba = next(t for t in result.transactions if t.tx_amount == 518.2)
    assert cba.tx_type == "Income"


def test_parse_date_format():
    """Dates are parsed correctly from 'DD Mon YYYY' format (4-digit year)."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    dates_years = {t.tx_date.year for t in result.transactions}
    assert 2026 in dates_years

    first = result.transactions[0]
    assert first.tx_date.day == 10
    assert first.tx_date.month == 4
    assert first.tx_date.year == 2026


def test_parse_balance():
    """Balance is parsed correctly."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    first = result.transactions[0]
    assert first.balance == 28244.77


def test_parse_description_prefers_original():
    """Original Description is preferred over Details when non-empty."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    # First row has Original Description set
    first = result.transactions[0]
    assert "Internal transfer" in first.tx_desc
    # Should NOT contain the verbose Details text with receipt numbers
    assert "Receipt number" not in first.tx_desc


def test_parse_description_falls_back_to_details():
    """Details is used when Original Description is empty."""
    parser = MacquarieParser()
    content = (
        "Transaction Date,Details,Account,Category,Subcategory,Tags,Notes,Debit,Credit,Balance,Original Description\n"
        '"10 Apr 2026","Some Details Text","Main account","Financial","Transfers","","","100","","1000",""\n'
    )
    result = parser.parse(content)
    assert result.transactions[0].tx_desc == "Some Details Text"


def test_parse_account_number_from_slug():
    """Account number is derived from account name slug."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    for tx in result.transactions:
        assert tx.account_number.startswith("MAC-")


def test_parse_multiple_accounts():
    """Multiple account names produce multiple account slugs."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    account_numbers = result.accounts_found
    assert "MAC-MAIN-ACCOUNT" in account_numbers
    assert "MAC-OFFSET-ACCOUNT" in account_numbers
    assert len(account_numbers) == 2


def test_parse_original_category_combined():
    """Category and Subcategory are combined as 'Category / Subcategory'."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    categories = {t.original_category for t in result.transactions}
    assert "Financial / Transfers" in categories
    assert "Travel / Flights" in categories
    assert "Income / Interest" in categories


def test_parse_bank_name():
    """Result has bank_name = 'Macquarie'."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    assert result.bank_name == "Macquarie"


def test_parse_account_type_is_bank():
    """All Macquarie accounts default to 'bank' type."""
    parser = MacquarieParser()
    result = parser.parse(SAMPLE_MAC_CSV)
    for tx in result.transactions:
        assert tx.account_type == "bank"


def test_parse_empty_content():
    """Parsing header-only CSV returns zero transactions."""
    parser = MacquarieParser()
    header_only = "Transaction Date,Details,Account,Category,Subcategory,Tags,Notes,Debit,Credit,Balance,Original Description\n"
    result = parser.parse(header_only)
    assert len(result.transactions) == 0
    assert result.row_count == 0


def test_parse_skips_empty_rows():
    """Rows missing date and amounts are skipped gracefully."""
    parser = MacquarieParser()
    content = (
        "Transaction Date,Details,Account,Category,Subcategory,Tags,Notes,Debit,Credit,Balance,Original Description\n"
        '"","","","","","","","","","",""\n'
        '"10 Apr 2026","Payment","Main account","Income","Interest","","","","50","1000","Payment"\n'
    )
    result = parser.parse(content)
    assert len(result.transactions) == 1
    assert result.skipped_count == 1


# ── Upload integration ─────────────────────────────────────────

@pytest.mark.anyio
async def test_upload_macquarie_csv(client):
    """POST /upload accepts a Macquarie CSV and inserts transactions."""
    csv_content = _load_fixture("macquarie_sample.csv")
    response = await client.post(
        "/upload",
        files={"file": ("macquarie_export.csv", csv_content.encode(), "text/csv")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["bank_name"] == "Macquarie"
    assert data["inserted"] > 0
    assert data["total_rows"] > 0
    assert any(acc.startswith("MAC-") for acc in data["accounts_found"])


@pytest.mark.anyio
async def test_upload_macquarie_creates_account(client):
    """Uploading Macquarie CSV creates an account with bank_name='Macquarie'."""
    csv_content = _load_fixture("macquarie_sample.csv")
    await client.post("/upload", files={"file": ("mac.csv", csv_content.encode(), "text/csv")})

    accounts = (await client.get("/accounts")).json()
    mac_account = next((a for a in accounts if a["bank_name"] == "Macquarie"), None)
    assert mac_account is not None
    assert mac_account["account_type"] == "bank"
    assert mac_account["account_number"].startswith("MAC-")


@pytest.mark.anyio
async def test_upload_macquarie_dedup(client):
    """Uploading the same Macquarie CSV twice deduplicates transactions."""
    csv_content = _load_fixture("macquarie_sample.csv")
    r1 = await client.post("/upload", files={"file": ("mac.csv", csv_content.encode(), "text/csv")})
    r2 = await client.post("/upload", files={"file": ("mac.csv", csv_content.encode(), "text/csv")})

    assert r1.json()["inserted"] > 0
    assert r2.json()["duplicates"] == r1.json()["inserted"]
    assert r2.json()["inserted"] == 0


@pytest.mark.anyio
async def test_get_supported_banks_includes_macquarie(client):
    """GET /upload/banks lists Macquarie as a supported bank with format metadata."""
    response = await client.get("/upload/banks")
    assert response.status_code == 200
    banks = response.json()
    names = [b["name"] for b in banks]
    assert "Macquarie" in names
    assert "Westpac" in names
    assert "NAB" in names
    # Macquarie entry has required_headers
    mac = next(b for b in banks if b["name"] == "Macquarie")
    assert "Transaction Date" in mac["required_headers"]
    assert "Debit" in mac["required_headers"]


@pytest.mark.anyio
async def test_upload_with_correct_bank_param(client):
    """POST /upload with matching bank param succeeds."""
    csv_content = _load_fixture("macquarie_sample.csv")
    response = await client.post(
        "/upload",
        files={"file": ("mac.csv", csv_content.encode(), "text/csv")},
        data={"bank": "Macquarie"},
    )
    assert response.status_code == 200
    assert response.json()["bank_name"] == "Macquarie"


@pytest.mark.anyio
async def test_upload_with_wrong_bank_param(client):
    """POST /upload with mismatched bank param returns 422 with a clear message."""
    csv_content = _load_fixture("macquarie_sample.csv")
    response = await client.post(
        "/upload",
        files={"file": ("mac.csv", csv_content.encode(), "text/csv")},
        data={"bank": "Westpac"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "Macquarie" in detail  # detected bank mentioned
    assert "Westpac" in detail   # selected bank mentioned
