"""
Tests for the Superhero Cash Statement CSV parser.

Covers:
- can_parse() detection (Cash Statement vs Transaction Statement vs bank CSVs)
- Metadata extraction (account number → slug, account name)
- Deposit rows imported as Income
- AUD→USD transfer rows imported as Expense
- Stock purchase rows ("You bought", "You ught" typo) skipped
- Dividend rows ("You were paid") skipped
- TOTAL row skipped
- Amount parsing: dollar signs, commas, negatives
- Balance parsing with commas
- SHA256 dedup
- Upload integration via POST /upload
"""

import io
import os

import pytest
from httpx import AsyncClient

from app.parsers.superhero_cash import SuperheroCashParser
from app.parsers.registry import detect_cash_parser, detect_parser

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_fixture(name):
    with open(os.path.join(FIXTURES_DIR, name)) as f:
        return f.read()


SAMPLE = """\
Entity Name,Sanghavi Ventures Pty Ltd
Account Name,Sanghavi Family Trust
Account Number,C6490998
Report Start Date,01/07/2025
Report End Date,19/04/2026
Report Creation Date,19/04/2026 21:08:51


0
"Date","Description","Debit ","Credit ","Balance "
"01/07/2025","You deposited funds into your account","","$300.00","$1,160.28"
"02/07/2025","You bought 2 Perth Mint Gold shares","-$101.02","","$1,059.26"
"14/07/2025","You were paid [income subtype] dividend from S&P 500 ETF","","$43.26","$1,049.42"
"22/07/2025","You deposited funds into your account","","$300.00","$1,424.37"
"23/07/2025","You transferred AUD into USD","-$1,100.00","","$91.91"
"06/08/2025","You ught 2 S&P 500 ETF shares","-$129.48","","$228.40"
"TOTAL","","-$1,330.50","$943.26",""
"""

TRANSACTION_STATEMENT = """\
Entity Name,Sanghavi Ventures Pty Ltd
Account Name,Sanghavi Family Trust
Account Number,C6490998

0
"Transaction Date","Settlement Date","Security","Security Code","Transaction Type","Quantity ","Average Price ","Net Amount ","Brokerage ","GST ","Tax "
"02/07/2025","04/07/2025","Perth Mint Gold","PMGOLD","Buy","2","$50.5100","-$101.02","$0.00","$0.00","$0.00"
"""

WESTPAC = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n"


# ── can_parse() ───────────────────────────────────────────────────────────────

def test_can_parse_cash_statement():
    assert SuperheroCashParser().can_parse(SAMPLE) is True


def test_can_parse_fixture():
    assert SuperheroCashParser().can_parse(_load_fixture("superhero_cash_sample.csv")) is True


def test_cannot_parse_transaction_statement():
    """Must not match the Superhero Transaction Statement."""
    assert SuperheroCashParser().can_parse(TRANSACTION_STATEMENT) is False


def test_cannot_parse_westpac():
    assert SuperheroCashParser().can_parse(WESTPAC) is False


def test_cannot_parse_empty():
    assert SuperheroCashParser().can_parse("") is False


# ── Registry ──────────────────────────────────────────────────────────────────

def test_registry_detects_cash_statement():
    p = detect_cash_parser(SAMPLE)
    assert p is not None
    assert isinstance(p, SuperheroCashParser)


def test_registry_returns_none_for_bank_csv():
    assert detect_cash_parser(WESTPAC) is None


def test_standard_bank_registry_does_not_match_cash():
    """detect_parser (standard bank) should not match the Cash Statement."""
    first_line = SAMPLE.split("\n", 1)[0].strip()
    assert detect_parser(first_line) is None


# ── Metadata ──────────────────────────────────────────────────────────────────

def test_account_number_slug():
    """Account number gets -CASH-AUD suffix."""
    result = SuperheroCashParser().parse(SAMPLE)
    assert len(result.transactions) > 0
    for tx in result.transactions:
        assert tx.account_number == "C6490998-CASH-AUD"


def test_account_name():
    result = SuperheroCashParser().parse(SAMPLE)
    for tx in result.transactions:
        assert tx.account_name == "Sanghavi Family Trust (AUD Cash)"


def test_account_type_is_bank():
    result = SuperheroCashParser().parse(SAMPLE)
    for tx in result.transactions:
        assert tx.account_type == "bank"


# ── Deposit rows ──────────────────────────────────────────────────────────────

def test_deposit_imported_as_income():
    result = SuperheroCashParser().parse(SAMPLE)
    deposits = [t for t in result.transactions if "deposited" in t.tx_desc]
    assert len(deposits) == 2
    for d in deposits:
        assert d.tx_type == "Income"
        assert d.tx_amount == pytest.approx(300.00)


def test_deposit_date():
    from datetime import datetime
    result = SuperheroCashParser().parse(SAMPLE)
    first = next(t for t in result.transactions if "deposited" in t.tx_desc)
    assert first.tx_date == datetime(2025, 7, 1)


# ── AUD→USD transfer ──────────────────────────────────────────────────────────

def test_fx_transfer_imported_as_expense():
    result = SuperheroCashParser().parse(SAMPLE)
    fx = [t for t in result.transactions if "USD" in t.tx_desc]
    assert len(fx) == 1
    assert fx[0].tx_type == "Expense"
    assert fx[0].tx_amount == pytest.approx(1100.00)


def test_fx_transfer_description_preserved():
    result = SuperheroCashParser().parse(SAMPLE)
    fx = next(t for t in result.transactions if "USD" in t.tx_desc)
    assert fx.tx_desc == "You transferred AUD into USD"


# ── Skipped rows ──────────────────────────────────────────────────────────────

def test_stock_purchase_skipped():
    result = SuperheroCashParser().parse(SAMPLE)
    buys = [t for t in result.transactions if "bought" in t.tx_desc.lower()]
    assert len(buys) == 0


def test_typo_bought_skipped():
    """'You ught' (Superhero typo) is also skipped."""
    result = SuperheroCashParser().parse(SAMPLE)
    typo = [t for t in result.transactions if "ught" in t.tx_desc.lower()]
    assert len(typo) == 0


def test_dividend_skipped():
    result = SuperheroCashParser().parse(SAMPLE)
    divs = [t for t in result.transactions if "dividend" in t.tx_desc.lower()]
    assert len(divs) == 0


def test_total_row_skipped():
    """TOTAL summary row does not appear as a transaction."""
    result = SuperheroCashParser().parse(SAMPLE)
    totals = [t for t in result.transactions if "TOTAL" in t.tx_desc.upper()]
    assert len(totals) == 0


# ── Row counts ────────────────────────────────────────────────────────────────

def test_only_imported_rows():
    """Only deposits and FX transfers are imported (3 in sample)."""
    result = SuperheroCashParser().parse(SAMPLE)
    assert len(result.transactions) == 3  # 2 deposits + 1 FX transfer


def test_fixture_import_counts():
    """Full fixture: 3 deposits + 1 FX transfer = 4 imported."""
    content = _load_fixture("superhero_cash_sample.csv")
    result = SuperheroCashParser().parse(content)
    deposits = [t for t in result.transactions if "deposited" in t.tx_desc]
    fx = [t for t in result.transactions if "USD" in t.tx_desc]
    assert len(deposits) == 3
    assert len(fx) == 1
    assert len(result.transactions) == 4


# ── Amount parsing ────────────────────────────────────────────────────────────

def test_balance_with_comma():
    """Balance like $1,160.28 is parsed correctly."""
    result = SuperheroCashParser().parse(SAMPLE)
    first = result.transactions[0]
    assert first.balance == pytest.approx(1160.28)


def test_large_fx_amount():
    result = SuperheroCashParser().parse(SAMPLE)
    fx = next(t for t in result.transactions if "USD" in t.tx_desc)
    assert fx.tx_amount == pytest.approx(1100.00)


# ── Upload integration ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_cash_statement(client: AsyncClient):
    """POST /upload with a Cash Statement creates a bank account + transactions."""
    content = _load_fixture("superhero_cash_sample.csv")
    response = await client.post(
        "/upload",
        files={"file": ("superhero_cash_sample.csv", io.BytesIO(content.encode()), "text/csv")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["bank_name"] == "Superhero"
    assert data["inserted"] == 4   # 3 deposits + 1 FX transfer
    assert data["duplicates"] == 0
    assert data["errors"] == []
    assert "C1234567-CASH-AUD" in data["accounts_found"]


@pytest.mark.asyncio
async def test_upload_cash_dedup(client: AsyncClient):
    """Re-uploading same Cash Statement yields 0 inserted."""
    content = _load_fixture("superhero_cash_sample.csv")
    for _ in range(2):
        r = await client.post(
            "/upload",
            files={"file": ("superhero_cash_sample.csv", io.BytesIO(content.encode()), "text/csv")},
        )
        assert r.status_code == 200
    assert r.json()["inserted"] == 0
    assert r.json()["duplicates"] == 4


@pytest.mark.asyncio
async def test_detect_cash_statement(client: AsyncClient):
    """POST /upload/detect recognises Cash Statement as csv_type=bank."""
    content = _load_fixture("superhero_cash_sample.csv")
    r = await client.post(
        "/upload/detect",
        files={"file": ("superhero_cash_sample.csv", io.BytesIO(content.encode()), "text/csv")},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["bank_name"] == "Superhero"
    assert data["csv_type"] == "bank"
    assert data["accounts"][0]["account_number"] == "C1234567-CASH-AUD"
    assert data["accounts"][0]["account_type"] == "bank"


@pytest.mark.asyncio
async def test_upload_cash_with_bank_selection(client: AsyncClient):
    """Uploading Cash Statement with bank='Superhero Cash' selected must not 422."""
    content = _load_fixture("superhero_cash_sample.csv")
    r = await client.post(
        "/upload",
        data={"bank": "Superhero Cash"},
        files={"file": ("superhero_cash_sample.csv", io.BytesIO(content.encode()), "text/csv")},
    )
    assert r.status_code == 200
    assert r.json()["inserted"] == 4


@pytest.mark.asyncio
async def test_cash_and_trade_uploads_separate_accounts(client: AsyncClient):
    """Cash Statement and Transaction Statement create two different accounts."""
    cash = _load_fixture("superhero_cash_sample.csv")
    trades = _load_fixture("superhero_sample.csv")

    r1 = await client.post("/upload", files={"file": ("cash.csv", io.BytesIO(cash.encode()), "text/csv")})
    r2 = await client.post("/upload", files={"file": ("trades.csv", io.BytesIO(trades.encode()), "text/csv")})

    assert r1.status_code == 200
    assert r2.status_code == 200

    # Accounts must be different
    assert r1.json()["accounts_found"] != r2.json()["accounts_found"]
    assert "C1234567-CASH-AUD" in r1.json()["accounts_found"]
    assert "C1234567" in r2.json()["accounts_found"]


# ── USD Cash Statement ────────────────────────────────────────────────────────

USD_SAMPLE = """\
Entity Name,Sanghavi Ventures Pty Ltd
Account Name,Sanghavi Family Trust
Account Number,C6490998
Report Start Date,01/07/2025
Report End Date,19/04/2026
Report Creation Date,19/04/2026 21:38:32


0
"Date","Description","Debit ","Credit ","Balance "
"07/07/2025","You were paid [income subtype] dividend from NVIDIA Corporation","","$0.45","$4.99"
"23/07/2025","You transferred AUD into USD","","$715.85","$720.84"
"23/07/2025","You bought 1 Meta Platforms Inc shares","-$701.99","","$18.85"
"06/10/2025","You transferred AUD into USD","","$452.98","$472.98"
"10/11/2025","You were paid [income subtype] dividend from ASML Holding NV","","$0.34","$87.38"
"TOTAL","","-$1,689.93","$1,690.34",""
"""


def test_usd_can_parse():
    assert SuperheroCashParser().can_parse(USD_SAMPLE) is True


def test_usd_account_number_slug():
    result = SuperheroCashParser().parse(USD_SAMPLE)
    for tx in result.transactions:
        assert tx.account_number == "C6490998-CASH-USD"


def test_usd_account_name():
    result = SuperheroCashParser().parse(USD_SAMPLE)
    for tx in result.transactions:
        assert tx.account_name == "Sanghavi Family Trust (USD Cash)"


def test_usd_account_type_is_bank():
    result = SuperheroCashParser().parse(USD_SAMPLE)
    for tx in result.transactions:
        assert tx.account_type == "bank"


def test_usd_fx_transfer_imported_as_income():
    """AUD→USD transfers appear as Credits in the USD account → Income."""
    result = SuperheroCashParser().parse(USD_SAMPLE)
    fx = [t for t in result.transactions if "USD" in t.tx_desc]
    assert len(fx) == 2
    for t in fx:
        assert t.tx_type == "Income"
    amounts = sorted(t.tx_amount for t in fx)
    assert amounts == pytest.approx([452.98, 715.85])


def test_usd_dividend_skipped():
    result = SuperheroCashParser().parse(USD_SAMPLE)
    divs = [t for t in result.transactions if "dividend" in t.tx_desc.lower()]
    assert len(divs) == 0


def test_usd_stock_purchase_skipped():
    result = SuperheroCashParser().parse(USD_SAMPLE)
    buys = [t for t in result.transactions if "bought" in t.tx_desc.lower()]
    assert len(buys) == 0


def test_usd_total_row_skipped():
    result = SuperheroCashParser().parse(USD_SAMPLE)
    totals = [t for t in result.transactions if "TOTAL" in t.tx_desc.upper()]
    assert len(totals) == 0


def test_usd_only_fx_transfers_imported():
    """Only the 2 FX transfer rows should be imported."""
    result = SuperheroCashParser().parse(USD_SAMPLE)
    assert len(result.transactions) == 2


def test_aud_and_usd_are_separate_accounts():
    """AUD and USD Cash Statements produce different account numbers."""
    aud = SuperheroCashParser().parse(SAMPLE)
    usd = SuperheroCashParser().parse(USD_SAMPLE)
    aud_numbers = {t.account_number for t in aud.transactions}
    usd_numbers = {t.account_number for t in usd.transactions}
    assert aud_numbers == {"C6490998-CASH-AUD"}
    assert usd_numbers == {"C6490998-CASH-USD"}
    assert aud_numbers.isdisjoint(usd_numbers)


def test_usd_can_parse_fixture():
    assert SuperheroCashParser().can_parse(_load_fixture("superhero_usd_cash_sample.csv")) is True


def test_usd_fixture_import_counts():
    """Full USD fixture: 2 FX transfers imported, rest skipped."""
    content = _load_fixture("superhero_usd_cash_sample.csv")
    result = SuperheroCashParser().parse(content)
    fx = [t for t in result.transactions if "USD" in t.tx_desc]
    assert len(fx) == 2
    assert len(result.transactions) == 2


@pytest.mark.asyncio
async def test_upload_usd_cash_statement(client: AsyncClient):
    """POST /upload with a USD Cash Statement creates a separate USD account."""
    content = _load_fixture("superhero_usd_cash_sample.csv")
    r = await client.post(
        "/upload",
        files={"file": ("superhero_usd_cash_sample.csv", io.BytesIO(content.encode()), "text/csv")},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["bank_name"] == "Superhero"
    assert data["inserted"] == 2
    assert data["duplicates"] == 0
    assert "C1234567-CASH-USD" in data["accounts_found"]


@pytest.mark.asyncio
async def test_aud_and_usd_uploads_separate_accounts(client: AsyncClient):
    """Uploading both AUD and USD Cash Statements creates two distinct accounts."""
    aud = _load_fixture("superhero_cash_sample.csv")
    usd = _load_fixture("superhero_usd_cash_sample.csv")

    r1 = await client.post("/upload", files={"file": ("aud.csv", io.BytesIO(aud.encode()), "text/csv")})
    r2 = await client.post("/upload", files={"file": ("usd.csv", io.BytesIO(usd.encode()), "text/csv")})

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert "C1234567-CASH-AUD" in r1.json()["accounts_found"]
    assert "C1234567-CASH-USD" in r2.json()["accounts_found"]
