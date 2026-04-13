"""
Westpac CSV parser.

Westpac CSV format:
  Header: Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial
  Date format: DD/MM/YYYY
  Account numbers:
    - Long number (e.g. 732289824046) → bank/savings account
    - Short number (e.g. 1912) → credit card (last 4 digits)
  Amounts:
    - Debit Amount = money going out (expense)
    - Credit Amount = money coming in (income)
    - One of them is always empty
  Balance: running balance (0.00 for credit cards)
  Categories: Westpac's own category (PAYMENT, DEP, CREDIT, OTHER, etc.)
"""

import csv
import io
import logging
from datetime import datetime

from app.parsers.base import BankParser, ParsedTransaction, ParseResult

logger = logging.getLogger(__name__)

# Westpac header columns
WESTPAC_HEADERS = {
    "Bank Account", "Date", "Narrative", "Debit Amount",
    "Credit Amount", "Balance", "Categories", "Serial",
}

# Credit card account numbers are short (4-6 digits = last digits of card)
CREDIT_CARD_MAX_LENGTH = 6


class WestpacParser(BankParser):
    """Parser for Westpac bank CSV exports."""

    @property
    def bank_name(self) -> str:
        return "Westpac"

    @property
    def description(self) -> str:
        return "Westpac personal/business bank and credit card accounts"

    @property
    def required_headers(self) -> list[str]:
        return ["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount"]

    def can_parse(self, header_line: str) -> bool:
        """Check if the header matches Westpac CSV format."""
        # Parse header, strip whitespace and quotes
        headers = {h.strip().strip('"') for h in header_line.split(",")}
        # Must have at least the core Westpac columns
        required = {"Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount"}
        return required.issubset(headers)

    def parse(self, content: str) -> ParseResult:
        """Parse Westpac CSV content into transactions."""
        transactions: list[ParsedTransaction] = []
        accounts_found: set[str] = set()
        errors: list[str] = []
        skipped = 0

        reader = csv.DictReader(io.StringIO(content))

        for row_num, row in enumerate(reader, start=2):  # start=2 because row 1 is header
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
        """Parse a single CSV row into a ParsedTransaction."""
        account_number = row.get("Bank Account", "").strip()
        date_str = row.get("Date", "").strip()
        narrative = row.get("Narrative", "").strip().strip('"')
        debit_str = row.get("Debit Amount", "").strip()
        credit_str = row.get("Credit Amount", "").strip()
        balance_str = row.get("Balance", "").strip()
        category = row.get("Categories", "").strip()

        # Skip empty rows
        if not account_number or not date_str or not narrative:
            return None

        # Parse date (DD/MM/YYYY)
        try:
            tx_date = datetime.strptime(date_str, "%d/%m/%Y")
        except ValueError:
            raise ValueError(f"Invalid date format: '{date_str}' (expected DD/MM/YYYY)")

        # Parse amounts — determine if income or expense
        debit = self._parse_amount(debit_str)
        credit = self._parse_amount(credit_str)

        if credit > 0:
            tx_amount = credit  # Store as positive
            tx_type = "Income"
        elif debit > 0:
            tx_amount = debit   # Store as positive
            tx_type = "Expense"
        else:
            # Both zero (e.g. foreign fee with 0.00) — treat as expense
            tx_amount = 0.0
            tx_type = "Expense"

        # Parse balance
        balance = self._parse_amount(balance_str) if balance_str else None

        # Infer account type from account number length
        account_type = (
            "credit_card"
            if len(account_number) <= CREDIT_CARD_MAX_LENGTH
            else "bank"
        )

        return ParsedTransaction(
            account_number=account_number,
            tx_date=tx_date,
            tx_desc=narrative,
            tx_amount=tx_amount,
            tx_type=tx_type,
            balance=balance,
            original_category=category if category else None,
            account_type=account_type,
        )

    @staticmethod
    def _parse_amount(value: str) -> float:
        """Parse an amount string, returning 0.0 for empty/invalid."""
        if not value:
            return 0.0
        try:
            return abs(float(value.replace(",", "")))
        except ValueError:
            return 0.0
