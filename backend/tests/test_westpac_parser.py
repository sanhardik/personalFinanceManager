"""
Tests for the Westpac CSV parser.

These tests are pure Python — no database needed.
They test the parser logic against known Westpac CSV formats.
"""

import os
import pytest
from datetime import datetime

from app.parsers.westpac import WestpacParser
from app.parsers.registry import detect_parser

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


@pytest.fixture
def parser():
    return WestpacParser()


@pytest.fixture
def sample_csv():
    """Load the Westpac sample CSV fixture."""
    path = os.path.join(FIXTURES_DIR, "westpac_sample.csv")
    with open(path) as f:
        return f.read()


# ── Parser detection ─────────────────────────────────────────

def test_westpac_parser_detects_header(parser):
    """WestpacParser.can_parse() should return True for Westpac headers."""
    header = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial"
    assert parser.can_parse(header) is True


def test_westpac_parser_rejects_unknown_header(parser):
    """WestpacParser.can_parse() should return False for non-Westpac headers."""
    header = "Transaction Date,Amount,Description,Reference"
    assert parser.can_parse(header) is False


def test_registry_detects_westpac():
    """detect_parser() should return WestpacParser for Westpac CSV."""
    header = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial"
    p = detect_parser(header)
    assert p is not None
    assert p.bank_name == "Westpac"


def test_registry_returns_none_for_unknown():
    """detect_parser() should return None for unrecognised headers."""
    header = "Date,Amount,Description"
    assert detect_parser(header) is None


# ── Parsing CSV content ──────────────────────────────────────

def test_parse_sample_csv(parser, sample_csv):
    """Parsing the sample Westpac CSV should extract transactions."""
    result = parser.parse(sample_csv)
    assert result.bank_name == "Westpac"
    assert len(result.transactions) > 0
    assert len(result.errors) == 0


def test_parse_detects_both_accounts(parser, sample_csv):
    """Sample CSV contains two account numbers."""
    result = parser.parse(sample_csv)
    assert "732289824046" in result.accounts_found


def test_parse_expense_transaction(parser):
    """Debit Amount should parse as Expense."""
    csv_content = (
        "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n"
        '732289824046,15/03/2026,"PAYMENT TO Coles",42.50,,1000.00,PAYMENT,'
    )
    result = parser.parse(csv_content)
    assert len(result.transactions) == 1
    tx = result.transactions[0]
    assert tx.tx_type == "Expense"
    assert tx.tx_amount == 42.50
    assert tx.account_number == "732289824046"
    assert tx.tx_desc == "PAYMENT TO Coles"
    assert tx.balance == 1000.00


def test_parse_income_transaction(parser):
    """Credit Amount should parse as Income."""
    csv_content = (
        "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n"
        '732289824046,20/03/2026,"DEPOSIT Wages",,5000.00,25000.00,CREDIT,'
    )
    result = parser.parse(csv_content)
    assert len(result.transactions) == 1
    tx = result.transactions[0]
    assert tx.tx_type == "Income"
    assert tx.tx_amount == 5000.00


def test_parse_date_format(parser):
    """Date should be parsed from DD/MM/YYYY format."""
    csv_content = (
        "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n"
        '732289824046,27/03/2026,"Test tx",10.00,,100.00,OTHER,'
    )
    result = parser.parse(csv_content)
    tx = result.transactions[0]
    assert tx.tx_date == datetime(2026, 3, 27)


def test_parse_credit_card_detection(parser):
    """Short account numbers (≤6 digits) should be detected as credit card."""
    csv_content = (
        "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n"
        '1912,27/03/2026,"COLES SCHOFIELDS",42.39,,0.00,OTHER,'
    )
    result = parser.parse(csv_content)
    tx = result.transactions[0]
    assert tx.account_type == "credit_card"
    assert tx.account_number == "1912"


def test_parse_bank_account_detection(parser):
    """Long account numbers should be detected as bank account."""
    csv_content = (
        "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n"
        '732289824046,27/03/2026,"PAYMENT TO Someone",100.00,,5000.00,PAYMENT,'
    )
    result = parser.parse(csv_content)
    tx = result.transactions[0]
    assert tx.account_type == "bank"


def test_parse_preserves_original_category(parser):
    """Westpac's own category should be preserved."""
    csv_content = (
        "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n"
        '732289824046,27/03/2026,"DEPOSIT Wages",,5000.00,25000.00,CREDIT,'
    )
    result = parser.parse(csv_content)
    tx = result.transactions[0]
    assert tx.original_category == "CREDIT"


def test_parse_zero_amount(parser):
    """Rows with 0.00 amounts (e.g. foreign fees) should still be parsed."""
    csv_content = (
        "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n"
        '1912,20/03/2026,"FOREIGN FEE AUD   0.10",0.00,,0.00,OTHER,'
    )
    result = parser.parse(csv_content)
    assert len(result.transactions) == 1
    tx = result.transactions[0]
    assert tx.tx_amount == 0.0
    assert tx.tx_type == "Expense"


def test_parse_empty_content(parser):
    """Parsing empty content should return empty result."""
    csv_content = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n"
    result = parser.parse(csv_content)
    assert len(result.transactions) == 0


def test_parse_row_count(parser, sample_csv):
    """Row count should match transactions + skipped."""
    result = parser.parse(sample_csv)
    assert result.row_count == len(result.transactions) + result.skipped_count
