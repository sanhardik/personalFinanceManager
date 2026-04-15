"""
Macquarie Bank CSV parser — handles both savings/transaction accounts and home loans.

Macquarie CSV format (same header for savings and loans):
  Header: Transaction Date,Details,Account,Category,Subcategory,Tags,Notes,Debit,Credit,Balance,Original Description
  Date format: DD Mon YYYY (e.g. "10 Apr 2026") — 4-digit year
  Account: text name column (e.g. "Main account", "Boondall") — NO account number in CSV
  Amounts:
    - Debit  = money going out (expense) — positive value, empty for income
    - Credit = money coming in (income)  — positive value, empty for expense
  Balance: running balance after transaction
    - Positive for savings accounts, negative for loan accounts (represents amount owed)
  Description: prefer "Original Description" (cleaner); fall back to "Details"

Loan detection (two-pass):
  If any row for an account has Subcategory = "Interest", that account is a home_loan.
  Loan account slugs include the drawdown amount to disambiguate duplicate names:
    "Basic Home Loan" ($102,300 drawdown) → "MAC-BASIC-HOME-LOAN-102300"
    "Basic Home Loan" ($134,200 drawdown) → "MAC-BASIC-HOME-LOAN-134200"
  Savings account slugs are unchanged:
    "Main account" → "MAC-MAIN-ACCOUNT"

Auto-categorisation hints embedded in original_category for loan accounts:
  Subcategory = "Interest"      → original_category includes "loan_interest"
  Details contains "drawdown"   → original_category includes "loan_drawdown"
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
    """
    slug = re.sub(r"[^a-z0-9]+", "-", account_name.strip().lower()).strip("-").upper()
    return f"MAC-{slug}"


def _parse_amount(value: str) -> float:
    """Parse an amount string, returning 0.0 for empty or invalid input."""
    if not value:
        return 0.0
    try:
        return abs(float(value.replace(",", "")))
    except ValueError:
        return 0.0


class MacquarieParser(BankParser):
    """Parser for Macquarie Bank CSV exports (savings accounts and home loans)."""

    @property
    def bank_name(self) -> str:
        return "Macquarie"

    @property
    def description(self) -> str:
        return "Macquarie Bank savings, transaction accounts and home loans"

    @property
    def required_headers(self) -> list[str]:
        return ["Transaction Date", "Details", "Debit", "Credit", "Balance", "Original Description"]

    def can_parse(self, header_line: str) -> bool:
        """Return True if the header matches Macquarie CSV format."""
        headers = {h.strip().strip('"') for h in header_line.split(",")}
        return MACQUARIE_REQUIRED_HEADERS.issubset(headers)

    def parse(self, content: str) -> ParseResult:
        """
        Parse Macquarie CSV content — savings accounts and home loans.

        Two-pass approach:
          Pass 1: Collect all rows per account name; detect loans (Subcategory=Interest);
                  find drawdown amounts for unique slug generation.
          Pass 2: Parse each row using the account type + slug determined in pass 1.
        """
        transactions: list[ParsedTransaction] = []
        accounts_found: set[str] = set()
        errors: list[str] = []
        skipped = 0

        # ── Pass 1: Classify accounts ─────────────────────────────────
        all_rows = list(csv.DictReader(io.StringIO(content)))

        # account_name → {is_loan, drawdown_amount}
        account_meta: dict[str, dict] = {}

        for row in all_rows:
            account_name = row.get("Account", "").strip().strip('"')
            subcategory = row.get("Subcategory", "").strip().strip('"')
            details = row.get("Details", "").strip().strip('"')
            orig_desc = row.get("Original Description", "").strip().strip('"')
            debit_str = row.get("Debit", "").strip().strip('"')

            if account_name not in account_meta:
                account_meta[account_name] = {"is_loan": False, "drawdown_amount": None}

            # Loan detection: interest CHARGED has Category="Financial" + Subcategory="Interest"
            # (not Category="Income" + Subcategory="Interest" which is savings interest earned)
            category = row.get("Category", "").strip().strip('"')
            if subcategory.lower() == "interest" and category.lower() == "financial":
                account_meta[account_name]["is_loan"] = True

            # Find loan drawdown row to capture original amount
            desc_lower = (orig_desc or details).lower()
            if "drawdown" in desc_lower and debit_str:
                try:
                    amount = abs(float(debit_str.replace(",", "")))
                    account_meta[account_name]["drawdown_amount"] = amount
                except ValueError:
                    pass

        # ── Build unique slugs ────────────────────────────────────────
        # Group account names by their base slug to detect collisions
        base_slug_to_names: dict[str, list[str]] = {}
        for name in account_meta:
            base = _account_slug(name)
            base_slug_to_names.setdefault(base, []).append(name)

        name_to_slug: dict[str, str] = {}
        for base_slug, names in base_slug_to_names.items():
            if len(names) == 1:
                # No collision — use plain slug
                name_to_slug[names[0]] = base_slug
            else:
                # Collision — disambiguate by drawdown amount for loan accounts
                for name in names:
                    drawdown = account_meta[name].get("drawdown_amount")
                    if drawdown:
                        # Round to nearest dollar, no decimals
                        amount_str = str(int(round(drawdown)))
                        name_to_slug[name] = f"{base_slug}-{amount_str}"
                    else:
                        # Fallback: append a short hash of the name
                        short_hash = abs(hash(name)) % 100000
                        name_to_slug[name] = f"{base_slug}-{short_hash}"

        # ── Pass 2: Parse rows ────────────────────────────────────────
        for row_num, row in enumerate(all_rows, start=2):
            try:
                account_name = row.get("Account", "").strip().strip('"')
                is_loan = account_meta.get(account_name, {}).get("is_loan", False)
                account_number = name_to_slug.get(account_name, _account_slug(account_name))
                account_type = "home_loan" if is_loan else "bank"

                tx = self._parse_row(
                    row=row,
                    row_num=row_num,
                    account_number=account_number,
                    account_name=account_name,
                    account_type=account_type,
                )
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

    def _parse_row(
        self,
        row: dict,
        row_num: int,
        account_number: str,
        account_name: str,
        account_type: str,
    ) -> ParsedTransaction | None:
        """Parse a single Macquarie CSV row into a ParsedTransaction."""
        date_str = row.get("Transaction Date", "").strip().strip('"')
        details = row.get("Details", "").strip().strip('"')
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

        # Build original_category — include subcategory for rule matching
        if category and subcategory:
            original_category = f"{category} / {subcategory}"
        elif category:
            original_category = category
        else:
            original_category = None

        return ParsedTransaction(
            account_number=account_number,
            account_name=account_name,
            tx_date=tx_date,
            tx_desc=tx_desc,
            tx_amount=tx_amount,
            tx_type=tx_type,
            balance=balance,
            original_category=original_category,
            account_type=account_type,
        )
