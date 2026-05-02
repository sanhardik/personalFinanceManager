"""
Unit and integration tests for the Superhero CSV parser.

Tests cover:
- can_parse() detection (Superhero vs non-Superhero content)
- Metadata extraction (account number, account name, entity name)
- Buy trade parsing (quantity, avg_price, negative net_amount)
- Dividend Received parsing (null quantity/avg_price, positive amount)
- Dollar-sign stripping in amount fields
- Empty settlement date handling
- Date format DD/MM/YYYY
- SHA256 dedup (same row twice → 1 inserted, 1 duplicate)
- Upload integration via POST /upload
- Holdings aggregation via GET /investments/{id}/holdings
"""

import os
import io

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.parsers.superhero import SuperheroParser
from app.parsers.registry import detect_stock_parser

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_fixture(name):
    with open(os.path.join(FIXTURES_DIR, name)) as f:
        return f.read()


SAMPLE_CSV = """\
Entity Name,Sanghavi Ventures Pty Ltd
Account Name,Sanghavi Family Trust
Account Number,C6490998
Report Start Date,01/07/2025
Report End Date,19/04/2026
Report Creation Date,19/04/2026 20:23:23

0
Transaction Date,Settlement Date,Security,Security Code,Transaction Type,Quantity,Average Price,Net Amount,Brokerage,GST,Tax
02/07/2025,04/07/2025,Perth Mint Gold,PMGOLD,Buy,2,$50.51,-$101.02,$0.00,$0.00,$0.00
14/07/2025,,S&P 500 ETF,IVV,Dividend Received,,,$43.26,$0.00,$0.00,$0.00
01/08/2025,05/08/2025,Vanguard US Total Market Shares Index ETF,VTS,Buy,3,$290.60,-$871.80,$2.00,$0.20,$0.00
"""

NON_SUPERHERO_BANK_CSV = """\
Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial
BSB: 732-000 Acc: 12345678,30/04/2026,COLES SUPERMARKETS,85.40,,1234.56,Groceries,
"""

NAB_CSV = """\
Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On
10 Apr 26,12.00,701314870,,TRANSFER CREDIT,Salary payment,31024.17,Transfers in,,10 Apr 26
"""


# ── can_parse() ───────────────────────────────────────────────────────────────

def test_can_parse_valid():
    """Detects Superhero CSV by scanning full content for the data header row."""
    parser = SuperheroParser()
    assert parser.can_parse(SAMPLE_CSV) is True


def test_can_parse_fixture():
    """Detects the real fixture file."""
    content = _load_fixture("superhero_sample.csv")
    parser = SuperheroParser()
    assert parser.can_parse(content) is True


def test_cannot_parse_bank_csv():
    """Does not trigger on a Westpac bank CSV."""
    parser = SuperheroParser()
    assert parser.can_parse(NON_SUPERHERO_BANK_CSV) is False


def test_cannot_parse_nab_csv():
    """Does not trigger on a NAB bank CSV."""
    parser = SuperheroParser()
    assert parser.can_parse(NAB_CSV) is False


def test_cannot_parse_empty():
    """Does not trigger on an empty string."""
    parser = SuperheroParser()
    assert parser.can_parse("") is False


# ── Registry detect_stock_parser() ───────────────────────────────────────────

def test_registry_detects_superhero():
    """detect_stock_parser() returns a SuperheroParser for valid Superhero content."""
    p = detect_stock_parser(SAMPLE_CSV)
    assert p is not None
    assert p.platform_name == "Superhero"


def test_registry_returns_none_for_bank_csv():
    """detect_stock_parser() returns None for a bank CSV."""
    assert detect_stock_parser(NON_SUPERHERO_BANK_CSV) is None


# ── Metadata extraction ───────────────────────────────────────────────────────

def test_metadata_extraction():
    """Extracts account number, account name, and entity name from header block."""
    parser = SuperheroParser()
    result = parser.parse(SAMPLE_CSV)
    assert result.account_number == "C6490998"
    assert result.account_name == "Sanghavi Family Trust"
    assert result.entity_name == "Sanghavi Ventures Pty Ltd"
    assert result.platform_name == "Superhero"


# ── Buy trade parsing ─────────────────────────────────────────────────────────

def test_buy_trade():
    """Buy trade: quantity, avg_price, negative net_amount parsed correctly."""
    parser = SuperheroParser()
    result = parser.parse(SAMPLE_CSV)
    buy = next(t for t in result.trades if t.trade_type == "Buy" and t.security_code == "PMGOLD")

    assert buy.security_code == "PMGOLD"
    assert buy.security_name == "Perth Mint Gold"
    assert buy.quantity == 2.0
    assert buy.avg_price == pytest.approx(50.51)
    assert buy.net_amount == pytest.approx(-101.02)
    assert buy.brokerage == pytest.approx(0.0)


def test_buy_with_brokerage():
    """Buy trade with non-zero brokerage and GST."""
    parser = SuperheroParser()
    result = parser.parse(SAMPLE_CSV)
    vts = next(t for t in result.trades if t.security_code == "VTS")
    assert vts.brokerage == pytest.approx(2.0)
    assert vts.gst == pytest.approx(0.20)


# ── Dividend Received parsing ─────────────────────────────────────────────────

def test_dividend_received():
    """Dividend Received row: quantity/avg_price are None, net_amount is positive."""
    parser = SuperheroParser()
    result = parser.parse(SAMPLE_CSV)
    div = next(t for t in result.trades if t.trade_type == "Dividend Received")
    assert div.security_code == "IVV"
    assert div.quantity is None
    assert div.avg_price is None
    assert div.net_amount == pytest.approx(43.26)


# ── Amount parsing ────────────────────────────────────────────────────────────

def test_dollar_sign_stripping():
    """Dollar signs are stripped from amounts."""
    parser = SuperheroParser()
    result = parser.parse(SAMPLE_CSV)
    buy = result.trades[0]
    # Should be a float, not still contain '$'
    assert isinstance(buy.net_amount, float)
    assert isinstance(buy.avg_price, float)


# ── Date parsing ──────────────────────────────────────────────────────────────

def test_date_format():
    """DD/MM/YYYY dates are parsed to datetime objects correctly."""
    parser = SuperheroParser()
    result = parser.parse(SAMPLE_CSV)
    buy = result.trades[0]
    from datetime import datetime
    assert buy.trade_date == datetime(2025, 7, 2)


def test_settlement_date_parsed():
    """Non-empty settlement date is parsed."""
    parser = SuperheroParser()
    result = parser.parse(SAMPLE_CSV)
    buy = result.trades[0]
    from datetime import datetime
    assert buy.settlement_date == datetime(2025, 7, 4)


def test_empty_settlement_date():
    """Empty settlement date becomes None without crashing."""
    parser = SuperheroParser()
    result = parser.parse(SAMPLE_CSV)
    div = next(t for t in result.trades if t.trade_type == "Dividend Received")
    assert div.settlement_date is None


# ── Row / skip counts ─────────────────────────────────────────────────────────

def test_row_count():
    """row_count matches number of data rows (excluding header)."""
    parser = SuperheroParser()
    result = parser.parse(SAMPLE_CSV)
    assert result.row_count == 3
    assert len(result.trades) == 3


def test_fixture_row_count():
    """Full fixture: 8 data rows, all parsed."""
    content = _load_fixture("superhero_sample.csv")
    parser = SuperheroParser()
    result = parser.parse(content)
    assert result.row_count == 8
    assert len(result.trades) == 8


# ── Integration: upload via API ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_creates_account_and_trades(client: AsyncClient):
    """POST /upload with a Superhero CSV creates an investment account and stock trades."""
    content = _load_fixture("superhero_sample.csv")
    response = await client.post(
        "/upload",
        files={"file": ("superhero_sample.csv", io.BytesIO(content.encode()), "text/csv")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["bank_name"] == "Superhero"
    assert data["inserted"] == 8
    assert data["duplicates"] == 0
    assert data["errors"] == []


@pytest.mark.asyncio
async def test_upload_dedup(client: AsyncClient):
    """Re-uploading the same CSV produces 0 inserted and 8 duplicates."""
    content = _load_fixture("superhero_sample.csv")
    for _ in range(2):
        response = await client.post(
            "/upload",
            files={"file": ("superhero_sample.csv", io.BytesIO(content.encode()), "text/csv")},
        )
        assert response.status_code == 200

    data = response.json()
    assert data["inserted"] == 0
    assert data["duplicates"] == 8


@pytest.mark.asyncio
async def test_upload_detect_endpoint(client: AsyncClient):
    """POST /upload/detect recognises a Superhero CSV without inserting."""
    content = _load_fixture("superhero_sample.csv")
    response = await client.post(
        "/upload/detect",
        files={"file": ("superhero_sample.csv", io.BytesIO(content.encode()), "text/csv")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["bank_name"] == "Superhero"
    assert data["csv_type"] == "stock"
    assert len(data["accounts"]) == 1
    assert data["accounts"][0]["account_type"] == "investment"


# ── Integration: holdings ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_holdings_after_upload(client: AsyncClient):
    """GET /investments/{id}/holdings returns aggregated holdings after upload."""
    content = _load_fixture("superhero_sample.csv")
    upload_resp = await client.post(
        "/upload",
        files={"file": ("superhero_sample.csv", io.BytesIO(content.encode()), "text/csv")},
    )
    assert upload_resp.status_code == 200

    # Get investment accounts to find the new account ID
    accounts_resp = await client.get("/investments")
    assert accounts_resp.status_code == 200
    accounts = accounts_resp.json()
    superhero_acc = next((a for a in accounts if a["bank_name"] == "Superhero"), None)
    assert superhero_acc is not None

    acc_id = superhero_acc["id"]
    holdings_resp = await client.get(f"/investments/{acc_id}/holdings")
    assert holdings_resp.status_code == 200
    holdings = holdings_resp.json()

    codes = {h["security_code"] for h in holdings}
    assert "PMGOLD" in codes
    assert "IVV" in codes
    assert "VTS" in codes
    assert "AAA" in codes

    pmgold = next(h for h in holdings if h["security_code"] == "PMGOLD")
    assert pmgold["quantity_held"] == pytest.approx(7.0)   # 2 + 5
    assert pmgold["cost_basis"] == pytest.approx(361.52)   # 101.02 + 260.50
    assert pmgold["total_dividends"] == pytest.approx(0.0)
    assert pmgold["current_price"] is None
    assert pmgold["current_value"] is None

    ivv = next(h for h in holdings if h["security_code"] == "IVV")
    assert ivv["total_dividends"] == pytest.approx(43.26 + 48.75)  # two dividends


@pytest.mark.asyncio
async def test_price_update_reflects_in_holdings(client: AsyncClient):
    """PATCH /investments/holdings/{id}/{code}/price updates current_value + unrealised_gain."""
    content = _load_fixture("superhero_sample.csv")
    await client.post(
        "/upload",
        files={"file": ("superhero_sample.csv", io.BytesIO(content.encode()), "text/csv")},
    )

    accounts = (await client.get("/investments")).json()
    acc_id = next(a["id"] for a in accounts if a["bank_name"] == "Superhero")

    patch_resp = await client.patch(
        f"/investments/holdings/{acc_id}/PMGOLD/price",
        json={"price": 55.00},
    )
    assert patch_resp.status_code == 200
    holding = patch_resp.json()
    assert holding["current_price"] == pytest.approx(55.00)
    assert holding["current_value"] == pytest.approx(55.00 * 7)  # 7 units
    assert holding["unrealised_gain"] is not None
