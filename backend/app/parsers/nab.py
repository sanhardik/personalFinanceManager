"""
NAB (National Australia Bank) CSV parser.

NAB CSV format:
  Header: Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On
  Note: column 4 (index 3) is always empty — NAB exports a blank column after Account Number.
  Date format: DD Mon YY (e.g. "10 Apr 26" = 10 April 2026)
  Amount: single signed float — negative = debit/expense, positive = credit/income
  Account Number: 6-10 digit account number (e.g. "701314870")
  Transaction Type: TRANSFER CREDIT, TRANSFER DEBIT, INTER-BANK CREDIT, etc.
  Transaction Details: free-text description
  Balance: running balance after transaction
  Category: NAB's own category label (Transfers in, Transfers out, etc.)
  Merchant Name: usually empty
  Processed On: settlement date (may differ from transaction date)
"""

import csv
import io
import logging
from datetime import datetime

from app.parsers.base import BankParser, ParsedTransaction, ParseResult

logger = logging.getLogger(__name__)

# Columns that must be present in the header to identify a NAB CSV
NAB_REQUIRED_HEADERS = {
    "Date", "Amount", "Account Number",
    "Transaction Type", "Transaction Details",
}

# NAB date format: "10 Apr 26" → DD Mon YY
NAB_DATE_FORMAT = "%d %b %y"


class NABParser(BankParser):
    """Parser for NAB (National Australia Bank) CSV exports."""

    @property
    def bank_name(self) -> str:
        return "NAB"

    def can_parse(self, header_line: str) -> bool:
        """Return True if the header matches NAB CSV format."""
        headers = {h.strip().strip('"') for h in header_line.split(",")}
        return NAB_REQUIRED_HEADERS.issubset(headers)

    def parse(self, content: str) -> ParseResult:
        """Parse NAB CSV content into transactions."""
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
        """Parse a single NAB CSV row into a ParsedTransaction."""
        date_str = row.get("Date", "").strip()
        amount_str = row.get("Amount", "").strip()
        account_number = row.get("Account Number", "").strip()
        tx_type_raw = row.get("Transaction Type", "").strip()
        details = row.get("Transaction Details", "").strip().strip('"')
        balance_str = row.get("Balance", "").strip()
        category = row.get("Category", "").strip()

        # Skip empty rows
        if not date_str or not amount_str or not account_number:
            return None

        # Parse date: "10 Apr 26" → datetime
        try:
            tx_date = datetime.strptime(date_str, NAB_DATE_FORMAT)
        except ValueError:
            raise ValueError(f"Invalid date format: '{date_str}' (expected DD Mon YY, e.g. '10 Apr 26')")

        # Parse amount — negative = expense, positive = income
        try:
            amount = float(amount_str.replace(",", ""))
        except ValueError:
            raise ValueError(f"Invalid amount: '{amount_str}'")

        if amount >= 0:
            tx_amount = amount
            tx_type = "Income"
        else:
            tx_amount = abs(amount)
            tx_type = "Expense"

        # Use Transaction Details as the description; fall back to Transaction Type
        tx_desc = details if details else tx_type_raw

        # Parse running balance
        balance = None
        if balance_str:
            try:
                balance = float(balance_str.replace(",", ""))
            except ValueError:
                pass

        # Account type: NAB account numbers are 6-10 digits → bank account.
        # Credit cards use a different export format; default to "bank" here.
        account_type = "bank"

        return ParsedTransaction(
            account_number=account_number,
            tx_date=tx_date,
            tx_desc=tx_desc,
            tx_amount=tx_amount,
            tx_type=tx_type,
            balance=balance,
            original_category=category if category else None,
            account_type=account_type,
        )
