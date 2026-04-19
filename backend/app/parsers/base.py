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
    tx_amount: float              # Positive = expense/debit, negative = income/credit
    tx_type: str                  # "Income" or "Expense"
    balance: float | None         # Balance after transaction (if available)
    original_category: str | None # Category from bank CSV (if available)
    account_type: str             # "bank", "credit_card", "home_loan" — inferred by parser
    account_name: str = ""        # Human-readable account name (used for loan account naming)


@dataclass
class ParseResult:
    """Result of parsing a CSV file."""

    bank_name: str
    transactions: list[ParsedTransaction]
    accounts_found: list[str]  # Unique account numbers found
    row_count: int             # Total rows processed
    skipped_count: int         # Rows skipped (header, empty, etc.)
    errors: list[str]          # Non-fatal parse errors


@dataclass
class ParsedStockTrade:
    """A single stock trade extracted from a brokerage CSV."""

    account_number: str
    trade_date: datetime
    settlement_date: datetime | None
    security_name: str
    security_code: str
    trade_type: str          # "Buy" | "Sell" | "Dividend Received"
    quantity: float | None   # None for dividends
    avg_price: float | None  # None for dividends
    net_amount: float        # negative=outflow (Buy), positive=inflow (Sell/Dividend)
    brokerage: float
    gst: float
    tax: float


@dataclass
class StockParseResult:
    """Result of parsing a brokerage CSV file."""

    platform_name: str
    account_number: str
    account_name: str
    entity_name: str
    trades: list[ParsedStockTrade]
    row_count: int
    skipped_count: int
    errors: list[str]


class BankParser(ABC):
    """
    Abstract base class for bank CSV parsers.

    Subclasses must implement:
    - bank_name: human-readable bank name
    - description: one-line description shown in the upload UI
    - required_headers: set of column names that identify this bank's CSV
    - can_parse(): check if this parser handles the given CSV headers
    - parse(): extract transactions from the CSV file
    """

    @property
    @abstractmethod
    def bank_name(self) -> str:
        """Human-readable bank name (e.g. 'Westpac')."""
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        """Short description of the CSV format, shown in the upload UI."""
        ...

    @property
    @abstractmethod
    def required_headers(self) -> list[str]:
        """Column names required in the CSV header to identify this bank."""
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
