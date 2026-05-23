# Adding a New Bank Parser

This guide walks you through adding support for a new Australian bank or financial institution. It is the single most impactful contribution you can make to this project.

No prior experience with the codebase is required — if you can read a CSV and write Python, you can write a parser.

---

## Overview

The parser system is built around a simple **pluggable architecture**:

```
CSV upload
    │
    ▼
registry.py ─── tries each parser's can_parse(header) in order
    │
    ▼
YourBankParser.parse(content) ─── returns ParseResult
    │
    ▼
upload service ─── upserts accounts, inserts transactions, deduplicates
```

Every bank parser:
1. Inherits from `BankParser` (the abstract base class)
2. Implements `can_parse(header_line)` — returns `True` if this CSV belongs to your bank
3. Implements `parse(content)` — returns a `ParseResult` containing `ParsedTransaction` objects
4. Is registered in `registry.py`

---

## Step 0 — Get a sample CSV

Export a statement from the bank's online banking portal. Most banks have an option like "Download transactions" or "Export as CSV".

Before using it in the project, **anonymise it**:
- Replace account numbers with `XXXXXXXXX`
- Replace real descriptions with generic ones like `GROCERY STORE` or `SALARY PAYMENT`
- Use fake amounts like `42.00`, `1500.00`
- Do not commit real financial data

Save your anonymised sample to `backend/tests/fixtures/<bankname>_sample.csv`.

---

## Step 1 — Understand the CSV format

Open the CSV in a text editor (not Excel — it may reformat dates). Look for:

| Thing to note | Why it matters |
|---------------|---------------|
| Column names in the header row | Used for `can_parse()` detection |
| Date format | `DD/MM/YYYY`, `DD Mon YY`, `YYYY-MM-DD`? |
| Amount columns | Single signed column, or separate Debit/Credit columns? |
| Account number location | In the CSV, or in metadata rows above the header? |
| Balance column | Present? Optional? |
| Any rows before the header | Some banks include metadata (account name, report dates) |

---

## Step 2 — Create the parser file

Create `backend/app/parsers/<bankname>.py`. Here's a complete template:

```python
"""
<BankName> CSV parser.

<BankName> CSV format:
  Header: <paste your header row here>
  Date format: DD/MM/YYYY
  Amounts: <describe the amount column structure>
  Account: <how account numbers appear>
"""

import csv
import io
import logging
from datetime import datetime

from app.parsers.base import BankParser, ParsedTransaction, ParseResult

logger = logging.getLogger(__name__)

# The columns that uniquely identify a <BankName> CSV.
# Be specific enough that you don't accidentally match other banks.
REQUIRED_HEADERS = {"Date", "Amount", "Account Number", "Description"}


class <BankName>Parser(BankParser):
    """Parser for <BankName> CSV exports."""

    @property
    def bank_name(self) -> str:
        return "<BankName>"

    @property
    def description(self) -> str:
        return "<BankName> transaction and savings accounts"

    @property
    def required_headers(self) -> list[str]:
        return list(REQUIRED_HEADERS)

    def can_parse(self, header_line: str) -> bool:
        """Return True if this header matches a <BankName> CSV."""
        headers = {h.strip().strip('"') for h in header_line.split(",")}
        return REQUIRED_HEADERS.issubset(headers)

    def parse(self, content: str) -> ParseResult:
        """Parse <BankName> CSV content into transactions."""
        transactions: list[ParsedTransaction] = []
        accounts_found: set[str] = set()
        errors: list[str] = []
        skipped = 0

        reader = csv.DictReader(io.StringIO(content))

        for row_num, row in enumerate(reader, start=2):
            try:
                tx = self._parse_row(row)
                if tx:
                    transactions.append(tx)
                    accounts_found.add(tx.account_number)
                else:
                    skipped += 1
            except Exception as e:
                errors.append(f"Row {row_num}: {e}")
                skipped += 1

        return ParseResult(
            bank_name=self.bank_name,
            transactions=transactions,
            accounts_found=sorted(accounts_found),
            row_count=len(transactions) + skipped,
            skipped_count=skipped,
            errors=errors,
        )

    def _parse_row(self, row: dict) -> ParsedTransaction | None:
        """Parse a single row. Return None to skip."""
        account_number = row.get("Account Number", "").strip()
        date_str = row.get("Date", "").strip()
        description = row.get("Description", "").strip()
        amount_str = row.get("Amount", "").strip()

        # Skip empty or summary rows
        if not account_number or not date_str or not description:
            return None

        # Parse date
        try:
            tx_date = datetime.strptime(date_str, "%d/%m/%Y")
        except ValueError:
            raise ValueError(f"Unexpected date format: '{date_str}'")

        # Parse amount (negative = expense, positive = income for signed columns)
        try:
            amount = float(amount_str.replace(",", "").replace("$", ""))
        except ValueError:
            raise ValueError(f"Could not parse amount: '{amount_str}'")

        if amount >= 0:
            tx_amount = amount
            tx_type = "Income"
        else:
            tx_amount = abs(amount)
            tx_type = "Expense"

        return ParsedTransaction(
            account_number=account_number,
            tx_date=tx_date,
            tx_desc=description,
            tx_amount=tx_amount,
            tx_type=tx_type,
            balance=None,           # Set if your CSV has a balance column
            original_category=None, # Set if your CSV has a category column
            account_type="bank",    # "bank", "credit_card", or "home_loan"
        )
```

---

## Step 3 — Handle common edge cases

### Separate Debit and Credit columns (like Westpac)

```python
debit_str = row.get("Debit Amount", "").strip()
credit_str = row.get("Credit Amount", "").strip()

debit = float(debit_str) if debit_str else 0.0
credit = float(credit_str) if credit_str else 0.0

if credit > 0:
    tx_amount, tx_type = credit, "Income"
else:
    tx_amount, tx_type = debit, "Expense"
```

### `DD Mon YY` date format (like NAB — e.g. `10 Apr 26`)

```python
tx_date = datetime.strptime(date_str, "%d %b %y")
```

### `DD Mon YYYY` date format (like Macquarie — e.g. `10 Apr 2026`)

```python
tx_date = datetime.strptime(date_str, "%d %b %Y")
```

### Metadata rows before the header

Some banks (Macquarie, Superhero) have lines like `Account Name: Main Account` above the real CSV header. In this case, override `can_parse` to check the **full file content** rather than just the first line, and register your parser using `detect_cash_parser()` in `registry.py` rather than `PARSERS`.

See `superhero_cash.py` for a working example.

### Account number not in the CSV

Macquarie doesn't include account numbers in their CSV. We derive a slug from the account name:

```python
account_slug = "MAC-" + account_name.upper().replace(" ", "-")
```

The user can rename the auto-created account after first upload.

---

## Step 4 — Register the parser

Open `backend/app/parsers/registry.py` and add your parser:

```python
from app.parsers.<bankname> import <BankName>Parser

PARSERS: list[BankParser] = [
    WestpacParser(),
    NABParser(),
    MacquarieParser(),
    <BankName>Parser(),   # ← add here
]
```

**Order matters** — parsers are tried in sequence and the first match wins. If your parser's `can_parse()` is overly broad (matches columns found in other banks' CSVs), put it later in the list.

---

## Step 5 — Write the tests

Create `backend/tests/test_<bankname>_parser.py`. Your test file needs at least **10 test cases**:

```python
import pytest
from app.parsers.<bankname> import <BankName>Parser
from app.parsers.registry import detect_parser

SAMPLE_CSV = """\
Date,Amount,Account Number,Description,Balance
01/05/2026,-42.50,XXXXXXXXX,GROCERY STORE,1234.56
02/05/2026,3000.00,XXXXXXXXX,SALARY PAYMENT,4234.56
03/05/2026,-15.00,XXXXXXXXX,STREAMING SERVICE,4219.56
"""

@pytest.fixture
def parser():
    return <BankName>Parser()

# ── Detection ──────────────────────────────────────────────────────────────

def test_can_parse_valid_header(parser):
    header = "Date,Amount,Account Number,Description,Balance"
    assert parser.can_parse(header) is True

def test_cannot_parse_westpac_header(parser):
    header = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial"
    assert parser.can_parse(header) is False

def test_registry_detects_bank(parser):
    header = "Date,Amount,Account Number,Description,Balance"
    detected = detect_parser(header)
    assert detected is not None
    assert detected.bank_name == "<BankName>"

# ── Amount parsing ─────────────────────────────────────────────────────────

def test_expense_row(parser):
    result = parser.parse(SAMPLE_CSV)
    grocery = result.transactions[0]
    assert grocery.tx_type == "Expense"
    assert grocery.tx_amount == 42.50

def test_income_row(parser):
    result = parser.parse(SAMPLE_CSV)
    salary = result.transactions[1]
    assert salary.tx_type == "Income"
    assert salary.tx_amount == 3000.00

# ── Date parsing ───────────────────────────────────────────────────────────

def test_date_parsed_correctly(parser):
    result = parser.parse(SAMPLE_CSV)
    assert result.transactions[0].tx_date.day == 1
    assert result.transactions[0].tx_date.month == 5
    assert result.transactions[0].tx_date.year == 2026

# ── Account ────────────────────────────────────────────────────────────────

def test_account_number_extracted(parser):
    result = parser.parse(SAMPLE_CSV)
    assert result.transactions[0].account_number == "XXXXXXXXX"

def test_accounts_found_list(parser):
    result = parser.parse(SAMPLE_CSV)
    assert "XXXXXXXXX" in result.accounts_found

# ── Balance ────────────────────────────────────────────────────────────────

def test_balance_field(parser):
    result = parser.parse(SAMPLE_CSV)
    assert result.transactions[0].balance == 1234.56

# ── Upload integration ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_creates_account(async_client, db_session):
    """End-to-end: upload → account created → transactions inserted."""
    import io
    response = await async_client.post(
        "/upload",
        files={"file": ("<bankname>_test.csv", io.BytesIO(SAMPLE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["inserted"] == 3
    assert data["duplicates"] == 0

@pytest.mark.asyncio
async def test_deduplication(async_client, db_session):
    """Uploading the same file twice should not insert duplicates."""
    import io
    for _ in range(2):
        await async_client.post(
            "/upload",
            files={"file": ("<bankname>_test.csv", io.BytesIO(SAMPLE_CSV.encode()), "text/csv")},
        )
    response = await async_client.post(
        "/upload",
        files={"file": ("<bankname>_test.csv", io.BytesIO(SAMPLE_CSV.encode()), "text/csv")},
    )
    data = response.json()
    assert data["inserted"] == 0
    assert data["duplicates"] == 3
```

Run your tests:

```bash
./run.sh test
```

All 10+ tests must be green before you open a PR.

---

## Step 6 — Update the README

Add your bank to the supported banks table in `README.md`:

```markdown
| Bank | Account Types | Status |
|------|--------------|--------|
| Westpac | Bank, Credit Card | ✅ Supported |
| NAB | Bank | ✅ Supported |
| Macquarie | Savings, Home Loan | ✅ Supported |
| <BankName> | Bank | ✅ Supported |   ← add this
```

---

## Step 7 — Open the PR

```bash
git add backend/app/parsers/<bankname>.py
git add backend/app/parsers/registry.py
git add backend/tests/test_<bankname>_parser.py
git add backend/tests/fixtures/<bankname>_sample.csv
git add README.md

git commit -m "feat(parser): add <BankName> CSV parser"
git push origin bank/<bankname>
```

Open a PR against `main` and fill in the PR template. The maintainer will review within 48 hours.

---

## Getting help

Stuck on a date format? Not sure how to handle metadata rows? Open a [Discussion](https://github.com/sanhardik/personalFinanceManager/discussions/categories/q-a) — happy to help you finish the parser.
