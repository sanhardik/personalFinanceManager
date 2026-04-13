"""
Macquarie Bank CSV parser.

Macquarie CSV format:
  Header: Transaction Date,Details,Account,Category,Subcategory,Tags,Notes,Debit,Credit,Balance,Original Description
  Date format: DD Mon YYYY (e.g. "10 Apr 2026") — 4-digit year, unlike NAB's 2-digit
  Account: text name column (e.g. "Main account") — NO account number in CSV
  Amounts:
    - Debit  = money going out (expense) — positive value
    - Credit = money coming in (income)  — positive value
    - One is always empty for a given row
  Balance: running balance after transaction
  Description: prefer "Original Description" (cleaner); fall back to "Details"
  Account number: derived from account name slug (e.g. "Main account" → "MAC-MAIN-ACCOUNT")
    because Macquarie does not include account numbers in CSV exports.
    Users can rename the auto-created account after first upload.
"""

import csv
import io
import logging
import re
from datetime import datetime

from app.parsers.base import BankParser, ParsedTransaction, ParseResult

logger = logging.getLogger(__name__)

# Columns that must be present to identify a Macquarie CSV
MACQUARIE_REQUIRED_HEADERS = {
    "Transaction Date", "Details", "Debit", "Credit",
    "Balance", "Original Description",
}

# Date format used by Macquarie (4-digit year)
MACQUARIE_DATE_FORMAT = "%d %b %Y"


def _account_slug(account_name: str) -> str:
    """
    Derive a stable pseudo account number from the account name.

    E.g. "Main account" → "MAC-MAIN-ACCOUNT"
         "Offset account" → "MAC-OFFSET-ACCOUNT"
    """
    slug = re.sub(r"[^a-z0-9]+", "-", account_name.strip().lower()).strip("-").upper()
    return f"MAC-{slug}"


class MacquarieParser(BankParser):
    """Parser for Macquarie Bank CSV exports."""

    @property
    def bank_name(self) -> str:
        return "Macquarie"

    @property
    def description(self) -> str:
        return "Macquarie Bank savings and transaction accounts"

    @property
    def required_headers(self) -> list[str]:
        return ["Transaction Date", "Details", "Debit", "Credit", "Balance", "Original Description"]

    def can_parse(self, header_line: str) -> bool:
        """Return True if the header matches Macquarie CSV format."""
        headers = {h.strip().strip('"') for h in header_line.split(",")}
        return MACQUARIE_REQUIRED_HEADERS.issubset(headers)

    def parse(self, content: str) -> ParseResult:
        """Parse Macquarie CSV content into transactions."""
        transactions: list[ParsedTransaction] = []
        accounts_found: set[str] = set()
        errors: list[str] = []
        skipped = 0

        reader = csv.DictReader(io.StringIO(content))

        for row_num, row in enumerate(reader, start=2):
            try:
                tx = self._parse_row(row, row_num)
                if tx:
                    transactions.append(tx)
                    accounts_found.add(tx.account_number)
                else:
                    skipped += 1
            except Exception as e:
                errors.append(f"Row {row_num}: {str(e)}")
                skipped += 1

        return ParseResult(
            bank_name=self.bank_name,
            transactions=transactions,
            accounts_found=sorted(accounts_found),
            row_count=len(transactions) + skipped,
            skipped_count=skipped,
            errors=errors,
        )

    def _parse_row(self, row: dict, row_num: int) -> ParsedTransaction | None:
        """Parse a single Macquarie CSV row into a ParsedTransaction."""
        date_str = row.get("Transaction Date", "").strip().strip('"')
        details = row.get("Details", "").strip().strip('"')
        account_name = row.get("Account", "").strip().strip('"')
        category = row.get("Category", "").strip().strip('"')
        subcategory = row.get("Subcategory", "").strip().strip('"')
        debit_str = row.get("Debit", "").strip().strip('"')
        credit_str = row.get("Credit", "").strip().strip('"')
        balance_str = row.get("Balance", "").strip().strip('"')
        orig_desc = row.get("Original Description", "").strip().strip('"')

        # Skip empty rows
        if not date_str or (not debit_str and not credit_str):
            return None

        # Parse date: "10 Apr 2026" → datetime
        try:
            tx_date = datetime.strptime(date_str, MACQUARIE_DATE_FORMAT)
        except ValueError:
            raise ValueError(
                f"Invalid date format: '{date_str}' (expected DD Mon YYYY, e.g. '10 Apr 2026')"
            )

        # Parse amounts
        debit = _parse_amount(debit_str)
        credit = _parse_amount(credit_str)

        if credit > 0:
            tx_amount = credit
            tx_type = "Income"
        elif debit > 0:
            tx_amount = debit
            tx_type = "Expense"
        else:
            # Both zero — treat as expense (e.g. fee waived)
            tx_amount = 0.0
            tx_type = "Expense"

        # Description: prefer Original Description (cleaner), fall back to Details
        tx_desc = orig_desc if orig_desc else details

        # Parse running balance
        balance = None
        if balance_str:
            try:
                balance = float(balance_str.replace(",", ""))
            except ValueError:
                pass

        # Derive pseudo account number from account name (no account number in CSV)
        account_number = _account_slug(account_name) if account_name else "MAC-UNKNOWN"

        # Combine Macquarie category + subcategory as original_category
        if category and subcategory:
            original_category = f"{category} / {subcategory}"
        elif category:
            original_category = category
        else:
            original_category = None

        return ParsedTransaction(
            account_number=account_number,
            tx_date=tx_date,
            tx_desc=tx_desc,
            tx_amount=tx_amount,
            tx_type=tx_type,
            balance=balance,
            original_category=original_category,
            account_type="bank",
        )


def _parse_amount(value: str) -> float:
    """Parse an amount string, returning 0.0 for empty or invalid input."""
    if not value:
        return 0.0
    try:
        return abs(float(value.replace(",", "")))
    except ValueError:
        return 0.0
