"""
Abstract base class for bank CSV parsers.

Each bank (Westpac, NAB, Macquarie) implements this ABC.
The parser registry auto-detects which parser to use based on CSV headers.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import BinaryIO


@dataclass
class ParsedTransaction:
    """
    A single transaction extracted from a CSV file.
    Bank-agnostic — all parsers produce these.
    """

    account_number: str
    tx_date: datetime
    tx_desc: str
    tx_amount: float       # Positive = expense/debit, negative = income/credit
    tx_type: str           # "Income" or "Expense"
    balance: float | None  # Balance after transaction (if available)
    original_category: str | None  # Category from bank CSV (if available)
    account_type: str      # "bank" or "credit_card" — inferred by parser


@dataclass
class ParseResult:
    """Result of parsing a CSV file."""

    bank_name: str
    transactions: list[ParsedTransaction]
    accounts_found: list[str]  # Unique account numbers found
    row_count: int             # Total rows processed
    skipped_count: int         # Rows skipped (header, empty, etc.)
    errors: list[str]          # Non-fatal parse errors


class BankParser(ABC):
    """
    Abstract base class for bank CSV parsers.

    Subclasses must implement:
    - bank_name: human-readable bank name
    - can_parse(): check if this parser handles the given CSV headers
    - parse(): extract transactions from the CSV file
    """

    @property
    @abstractmethod
    def bank_name(self) -> str:
        """Human-readable bank name (e.g. 'Westpac')."""
        ...

    @abstractmethod
    def can_parse(self, header_line: str) -> bool:
        """
        Return True if this parser can handle the CSV based on its header.

        Args:
            header_line: The first line of the CSV file.
        """
        ...

    @abstractmethod
    def parse(self, content: str) -> ParseResult:
        """
        Parse CSV content into a list of transactions.

        Args:
            content: Full CSV file content as a string.

        Returns:
            ParseResult with transactions and metadata.
        """
        ...
