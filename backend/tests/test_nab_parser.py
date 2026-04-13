"""
Unit tests for the NAB CSV parser.

Tests cover:
- Header detection (NAB vs non-NAB)
- Parser registry auto-detection
- Income (positive amount) and expense (negative amount) parsing
- Date format DD Mon YY
- Balance parsing
- Account number
- Original category preservation
- Empty/invalid row handling
- Upload integration via POST /upload
"""

import os
import pytest

from app.parsers.nab import NABParser
from app.parsers.registry import detect_parser

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_fixture(name):
    with open(os.path.join(FIXTURES_DIR, name)) as f:
        return f.read()


# Minimal NAB CSV for unit tests — same format as real export
SAMPLE_NAB_CSV = """\
Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On
10 Apr 26,12.00,701314870,,TRANSFER CREDIT,CARLA M NICHOLLS Early learning books,31024.17,Transfers in,,10 Apr 26
07 Apr 26,-300.00,701314870,,TRANSFER DEBIT,INTERNET TRANSFER Funds trns,31012.17,Transfers out,,07 Apr 26
07 Apr 26,-555.56,701314870,,TRANSFER DEBIT,ONLINE C5528869017 Funds trns SANGHAVI VEN,31312.17,Internal transfers,,07 Apr 26
07 Apr 26,300.00,701314870,,INTER-BANK CREDIT,HARDIK SANGHAVI THE TRUSTEE FOR,31867.73,Transfers in,,07 Apr 26
"""


# ── Header detection ──────────────────────────────────────────

def test_nab_parser_detects_header():
    """NABParser.can_parse() returns True for a real NAB header."""
    parser = NABParser()
    header = "Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On"
    assert parser.can_parse(header) is True


def test_nab_parser_rejects_westpac_header():
    """NABParser.can_parse() returns False for a Westpac header."""
    parser = NABParser()
    header = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial"
    assert parser.can_parse(header) is False


def test_nab_parser_rejects_unknown_header():
    """NABParser.can_parse() returns False for an unknown header."""
    parser = NABParser()
    assert parser.can_parse("col1,col2,col3") is False


def test_registry_detects_nab():
    """detect_parser() returns NABParser for a NAB header."""
    header = "Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On"
    parser = detect_parser(header)
    assert parser is not None
    assert parser.bank_name == "NAB"


def test_registry_still_detects_westpac():
    """Adding NAB parser doesn't break Westpac detection."""
    header = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial"
    parser = detect_parser(header)
    assert parser is not None
    assert parser.bank_name == "Westpac"


# ── Parsing ───────────────────────────────────────────────────

def test_parse_row_count():
    """Parser returns the correct number of transactions."""
    parser = NABParser()
    result = parser.parse(SAMPLE_NAB_CSV)
    assert result.row_count == 4
    assert len(result.transactions) == 4
    assert result.skipped_count == 0


def test_parse_income_transaction():
    """Positive amount → Income type, stored as positive tx_amount."""
    parser = NABParser()
    result = parser.parse(SAMPLE_NAB_CSV)
    income = [t for t in result.transactions if t.tx_type == "Income"]
    assert len(income) == 2
    for tx in income:
        assert tx.tx_amount > 0


def test_parse_expense_transaction():
    """Negative amount → Expense type, stored as positive tx_amount."""
    parser = NABParser()
    result = parser.parse(SAMPLE_NAB_CSV)
    expenses = [t for t in result.transactions if t.tx_type == "Expense"]
    assert len(expenses) == 2
    for tx in expenses:
        assert tx.tx_amount > 0  # Always stored positive


def test_parse_amounts():
    """Amounts are parsed correctly from signed floats."""
    parser = NABParser()
    result = parser.parse(SAMPLE_NAB_CSV)
    amounts = {(t.tx_desc[:10], t.tx_amount, t.tx_type) for t in result.transactions}
    assert ("CARLA M NI", 12.00, "Income") in amounts
    assert ("INTERNET T", 300.00, "Expense") in amounts
    assert ("ONLINE C55", 555.56, "Expense") in amounts


def test_parse_date_format():
    """Dates are parsed correctly from 'DD Mon YY' format."""
    parser = NABParser()
    result = parser.parse(SAMPLE_NAB_CSV)
    dates = {t.tx_date.year for t in result.transactions}
    assert 2026 in dates

    first = result.transactions[0]
    assert first.tx_date.day == 10
    assert first.tx_date.month == 4
    assert first.tx_date.year == 2026


def test_parse_account_number():
    """Account number is correctly extracted."""
    parser = NABParser()
    result = parser.parse(SAMPLE_NAB_CSV)
    for tx in result.transactions:
        assert tx.account_number == "701314870"


def test_parse_accounts_found():
    """accounts_found lists unique account numbers."""
    parser = NABParser()
    result = parser.parse(SAMPLE_NAB_CSV)
    assert result.accounts_found == ["701314870"]
    assert result.bank_name == "NAB"


def test_parse_balance():
    """Balance is parsed correctly."""
    parser = NABParser()
    result = parser.parse(SAMPLE_NAB_CSV)
    first = result.transactions[0]
    assert first.balance == 31024.17


def test_parse_description():
    """Transaction Details is used as the description."""
    parser = NABParser()
    result = parser.parse(SAMPLE_NAB_CSV)
    descs = [t.tx_desc for t in result.transactions]
    assert any("CARLA M NICHOLLS" in d for d in descs)
    assert any("INTERNET TRANSFER" in d for d in descs)


def test_parse_original_category():
    """NAB category column is preserved as original_category."""
    parser = NABParser()
    result = parser.parse(SAMPLE_NAB_CSV)
    categories = {t.original_category for t in result.transactions}
    assert "Transfers in" in categories
    assert "Transfers out" in categories


def test_parse_account_type_defaults_to_bank():
    """NAB accounts default to 'bank' type."""
    parser = NABParser()
    result = parser.parse(SAMPLE_NAB_CSV)
    for tx in result.transactions:
        assert tx.account_type == "bank"


def test_parse_empty_content():
    """Parsing header-only CSV returns zero transactions."""
    parser = NABParser()
    header_only = "Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On\n"
    result = parser.parse(header_only)
    assert len(result.transactions) == 0
    assert result.row_count == 0


def test_parse_skips_empty_rows():
    """Rows missing date or amount are skipped gracefully."""
    parser = NABParser()
    content = (
        "Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On\n"
        ",,,,,,,,\n"  # completely empty row
        "10 Apr 26,12.00,701314870,,TRANSFER CREDIT,Test,31000.00,Transfers in,,10 Apr 26\n"
    )
    result = parser.parse(content)
    assert len(result.transactions) == 1
    assert result.skipped_count == 1


# ── Upload integration ────────────────────────────────────────

@pytest.mark.anyio
async def test_upload_nab_csv(client):
    """POST /upload accepts a NAB CSV and inserts transactions."""
    csv_content = _load_fixture("nab_sample.csv")
    response = await client.post(
        "/upload",
        files={"file": ("nab_export.csv", csv_content.encode(), "text/csv")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["bank_name"] == "NAB"
    assert data["inserted"] > 0
    assert data["total_rows"] > 0
    assert "701314870" in data["accounts_found"]


@pytest.mark.anyio
async def test_upload_nab_creates_account(client):
    """Uploading NAB CSV creates an account with bank_name='NAB'."""
    csv_content = _load_fixture("nab_sample.csv")
    await client.post("/upload", files={"file": ("nab.csv", csv_content.encode(), "text/csv")})

    accounts = (await client.get("/accounts")).json()
    nab_account = next((a for a in accounts if a["bank_name"] == "NAB"), None)
    assert nab_account is not None
    assert nab_account["account_type"] == "bank"


@pytest.mark.anyio
async def test_upload_nab_dedup(client):
    """Uploading the same NAB CSV twice deduplicates transactions."""
    csv_content = _load_fixture("nab_sample.csv")
    r1 = await client.post("/upload", files={"file": ("nab.csv", csv_content.encode(), "text/csv")})
    r2 = await client.post("/upload", files={"file": ("nab.csv", csv_content.encode(), "text/csv")})

    assert r1.json()["inserted"] > 0
    assert r2.json()["duplicates"] == r1.json()["inserted"]
    assert r2.json()["inserted"] == 0


@pytest.mark.anyio
async def test_get_supported_banks_includes_nab(client):
    """GET /upload/banks lists NAB as a supported bank."""
    response = await client.get("/upload/banks")
    assert response.status_code == 200
    banks = response.json()
    names = [b["name"] for b in banks]
    assert "NAB" in names
    assert "Westpac" in names
