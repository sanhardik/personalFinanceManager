"""
Superhero Cash Statement CSV parser.

Superhero Cash Statement format:
  Multi-row metadata header (same as Transaction Statement):
    Entity Name,       Sanghavi Ventures Pty Ltd
    Account Name,      Sanghavi Family Trust
    Account Number,    C6490998
    ...
  Then the data header row:
    "Date","Description","Debit ","Credit ","Balance "
  Then data rows:
    "01/07/2025","You deposited funds into your account","","$300.00","$1,160.28"
    "02/07/2025","You bought 2 Perth Mint Gold shares","-$101.02","","$1,059.26"
    "TOTAL","","-$13,324.11","$12,904.92",""

Import rules:
  IMPORT  — "You deposited funds into your account"   → Credit / Income
  IMPORT  — "You transferred AUD into USD"            → Debit  / Expense
  SKIP    — "You bought ..."                           → already in Transaction Statement
  SKIP    — "You ught ..."                             → source typo for "You bought"
  SKIP    — "You were paid ... dividend ..."           → already in Transaction Statement
  SKIP    — Date == "TOTAL"                            → summary row

Account:
  account_number: {Account Number}-CASH-AUD  (e.g. "C6490998-CASH-AUD")
  account_name:   {Account Name} (AUD Cash)  (e.g. "Sanghavi Family Trust (AUD Cash)")
  account_type:   "bank"
  bank_name:      "Superhero"

Amounts:
  Debit column  → Expense (positive amount stored)
  Credit column → Income  (positive amount stored)
  Values may include "$", "-", and "," — all stripped before parsing.
"""

import csv
import io
import logging
from datetime import datetime

from app.parsers.base import BankParser, ParsedTransaction, ParseResult

logger = logging.getLogger(__name__)

# Required columns to identify a Superhero Cash Statement (after quote + space stripping)
CASH_REQUIRED_HEADERS = {"Date", "Description", "Debit", "Credit", "Balance"}

# Columns that identify the Transaction Statement — used to avoid false-positive matches
TRANSACTION_STATEMENT_MARKERS = {"Transaction Date", "Security Code", "Transaction Type"}

DATE_FORMAT = "%d/%m/%Y"

# Description prefixes to skip (lowercased for case-insensitive comparison)
SKIP_PREFIXES = (
    "you bought",
    "you ught",       # Superhero source typo for "you bought"
    "you were paid",
)


def _parse_amount(value: str) -> float:
    """Strip $, - and , then return absolute float. Returns 0.0 for empty."""
    if not value or not value.strip():
        return 0.0
    cleaned = value.strip().replace("$", "").replace(",", "").replace("-", "")
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _should_skip(description: str) -> bool:
    """Return True if this row should not be imported."""
    d = description.strip().lower()
    return any(d.startswith(p) for p in SKIP_PREFIXES)


class SuperheroCashParser:
    """
    Parser for Superhero Cash Statement CSV exports.

    Operates on full file content (not just header line) because the
    Cash Statement has a multi-row metadata block before the data header.
    Produces ParseResult (bank-style transactions) — not stock trades.
    """

    @property
    def bank_name(self) -> str:
        return "Superhero"

    @property
    def description(self) -> str:
        return "Superhero Cash Statement — AUD cash account (deposits & FX transfers)"

    @property
    def required_headers(self) -> list[str]:
        return ["Date", "Description", "Debit", "Credit", "Balance"]

    def can_parse(self, content: str) -> bool:
        """
        Return True if the content looks like a Superhero Cash Statement.

        Scans the first 30 lines for the data header row containing the
        required columns. Also checks that this is NOT a Transaction Statement
        (which shares the same metadata block format).
        """
        lines = content.splitlines()[:30]
        for line in lines:
            cols = {c.strip().strip('"').strip() for c in line.split(",")}
            # Must have all cash statement columns
            if not CASH_REQUIRED_HEADERS.issubset(cols):
                continue
            # Must NOT look like the Transaction Statement
            if TRANSACTION_STATEMENT_MARKERS.intersection(cols):
                continue
            return True
        return False

    def parse(self, content: str) -> ParseResult:
        """
        Parse a Superhero Cash Statement into a ParseResult.

        Pass 1: extract metadata (account number, account name).
        Pass 2: find data header row, parse transaction rows.
        """
        lines = content.splitlines()
        errors: list[str] = []

        # ── Pass 1: metadata ──────────────────────────────────────────────────
        entity_name = ""
        account_name = ""
        account_number = ""
        header_row_index = -1

        for i, line in enumerate(lines):
            if not line.strip():
                continue

            parts = [p.strip().strip('"').strip() for p in line.split(",", 1)]
            if len(parts) >= 2:
                label = parts[0].lower()
                value = parts[1].strip().strip('"').strip() if len(parts) > 1 else ""
                if label == "entity name":
                    entity_name = value
                elif label == "account name":
                    account_name = value
                elif label == "account number":
                    account_number = value

            # Detect data header row
            cols = {c.strip().strip('"').strip() for c in line.split(",")}
            if CASH_REQUIRED_HEADERS.issubset(cols) and not TRANSACTION_STATEMENT_MARKERS.intersection(cols):
                header_row_index = i
                break

        if header_row_index == -1:
            return ParseResult(
                bank_name=self.bank_name,
                transactions=[],
                accounts_found=[],
                row_count=0,
                skipped_count=0,
                errors=["Could not find data header row in Superhero Cash Statement"],
            )

        # Derive the AUD cash account number and name
        cash_account_number = f"{account_number}-CASH-AUD"
        cash_account_name = f"{account_name} (AUD Cash)" if account_name else cash_account_number

        # ── Pass 2: parse rows ────────────────────────────────────────────────
        data_section = "\n".join(lines[header_row_index:])
        reader = csv.DictReader(io.StringIO(data_section))
        reader.fieldnames = [f.strip().strip('"').strip() for f in (reader.fieldnames or [])]

        transactions: list[ParsedTransaction] = []
        row_count = 0
        skipped_count = 0

        for row in reader:
            row_count += 1
            row = {k.strip().strip('"').strip(): (v.strip().strip('"').strip() if v else "") for k, v in row.items()}

            date_str = row.get("Date", "")
            description = row.get("Description", "")

            # Skip the TOTAL summary row
            if date_str.upper() == "TOTAL":
                skipped_count += 1
                continue

            # Skip stock purchases and dividends
            if _should_skip(description):
                skipped_count += 1
                continue

            # Parse date
            try:
                tx_date = datetime.strptime(date_str, DATE_FORMAT)
            except ValueError:
                errors.append(f"Row {row_count}: invalid date '{date_str}'")
                skipped_count += 1
                continue

            if not description:
                skipped_count += 1
                continue

            # Determine amount and direction from Debit/Credit columns
            debit_str = row.get("Debit", "")
            credit_str = row.get("Credit", "")
            balance_str = row.get("Balance", "")

            if credit_str:
                tx_amount = _parse_amount(credit_str)
                tx_type = "Income"
            elif debit_str:
                tx_amount = _parse_amount(debit_str)
                tx_type = "Expense"
            else:
                skipped_count += 1
                continue

            balance = _parse_amount(balance_str) if balance_str else None

            transactions.append(ParsedTransaction(
                account_number=cash_account_number,
                tx_date=tx_date,
                tx_desc=description,
                tx_amount=tx_amount,
                tx_type=tx_type,
                balance=balance,
                original_category=None,
                account_type="bank",
                account_name=cash_account_name,
            ))

        return ParseResult(
            bank_name=self.bank_name,
            transactions=transactions,
            accounts_found=[cash_account_number] if transactions else [],
            row_count=row_count,
            skipped_count=skipped_count,
            errors=errors,
        )
