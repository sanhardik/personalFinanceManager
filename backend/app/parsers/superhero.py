"""
Superhero brokerage CSV parser.

Superhero CSV format:
  Multi-row metadata header (not a standard single-row header):
    Entity Name,       Sanghavi Ventures Pty Ltd
    Account Name,      Sanghavi Family Trust
    Account Number,    C6490998
    Report Start Date, 01/07/2025
    Report End Date,   19/04/2026
    Report Creation Date, 19/04/2026 20:23:23
    (blank rows, possibly a "0" row)
  Then the data header row:
    Transaction Date,Settlement Date,Security,Security Code,Transaction Type,
    Quantity,Average Price,Net Amount,Brokerage,GST,Tax
  Then data rows:
    02/07/2025,04/07/2025,Perth Mint Gold,PMGOLD,Buy,2,$50.51,-$101.02,$0.00,$0.00,$0.00
    14/07/2025,,S&P 500 ETF,IVV,Dividend Received,,,43.26,$0.00,$0.00,$0.00

Key parsing notes:
  - Date format: DD/MM/YYYY
  - Amounts have optional "$" prefix; Buy net_amount is negative (outflow)
  - Dividends have empty Quantity and Average Price columns
  - Settlement Date can be empty
  - Account Number extracted from metadata row
"""

import csv
import io
import logging
from datetime import datetime

from app.parsers.base import ParsedStockTrade, StockParseResult

logger = logging.getLogger(__name__)

# Required column names in the data header row to identify a Superhero CSV
SUPERHERO_REQUIRED_HEADERS = {
    "Transaction Date",
    "Security Code",
    "Transaction Type",
    "Net Amount",
}

DATE_FORMAT = "%d/%m/%Y"


def _parse_amount(value: str) -> float:
    """Parse a dollar amount string, stripping '$' and handling negatives."""
    if not value or not value.strip():
        return 0.0
    cleaned = value.strip().replace("$", "").replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _parse_date(value: str) -> datetime | None:
    """Parse DD/MM/YYYY date string, returning None if empty or invalid."""
    if not value or not value.strip():
        return None
    try:
        return datetime.strptime(value.strip(), DATE_FORMAT)
    except ValueError:
        return None


class SuperheroParser:
    """
    Parser for Superhero brokerage CSV exports.

    Unlike bank parsers, this scanner operates on the full file content
    (not just the header line) because the Superhero CSV has a multi-row
    metadata block before the actual data header.
    """

    @property
    def platform_name(self) -> str:
        return "Superhero"

    def can_parse(self, content: str) -> bool:
        """
        Return True if the content looks like a Superhero CSV.

        Scans the first 30 lines for a row that contains all required column names.
        Handles quoted headers (e.g. "Transaction Date") and trailing spaces
        (e.g. "Net Amount ") that Superhero includes in its exports.
        """
        lines = content.splitlines()[:30]
        for line in lines:
            # Strip quotes and surrounding whitespace from each token
            cols = {c.strip().strip('"').strip() for c in line.split(",")}
            if SUPERHERO_REQUIRED_HEADERS.issubset(cols):
                return True
        return False

    def parse(self, content: str) -> StockParseResult:
        """
        Parse a Superhero CSV into a StockParseResult.

        Pass 1: scan metadata rows to extract account info.
        Pass 2: find the data header row, then parse trade rows.
        """
        lines = content.splitlines()
        errors: list[str] = []

        # ── Pass 1: extract metadata ─────────────────────────────────────
        entity_name = ""
        account_name = ""
        account_number = ""
        header_row_index = -1

        for i, line in enumerate(lines):
            if not line.strip():
                continue

            # Look for metadata key-value rows (first column is label)
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

            # Detect the data header row (handle quoted headers + trailing spaces)
            cols = {c.strip().strip('"').strip() for c in line.split(",")}
            if SUPERHERO_REQUIRED_HEADERS.issubset(cols):
                header_row_index = i
                break

        if header_row_index == -1:
            return StockParseResult(
                platform_name=self.platform_name,
                account_number=account_number,
                account_name=account_name,
                entity_name=entity_name,
                trades=[],
                row_count=0,
                skipped_count=0,
                errors=["Could not find data header row in Superhero CSV"],
            )

        # ── Pass 2: parse trade rows ──────────────────────────────────────
        data_section = "\n".join(lines[header_row_index:])
        reader = csv.DictReader(io.StringIO(data_section))

        # Normalise column names (strip whitespace)
        reader.fieldnames = [f.strip() for f in (reader.fieldnames or [])]

        trades: list[ParsedStockTrade] = []
        row_count = 0
        skipped_count = 0

        for row in reader:
            row_count += 1

            # Strip whitespace from all cell values
            row = {k.strip(): (v.strip() if v else "") for k, v in row.items()}

            trade_date = _parse_date(row.get("Transaction Date", ""))
            if trade_date is None:
                skipped_count += 1
                continue

            security_code = row.get("Security Code", "").strip()
            trade_type = row.get("Transaction Type", "").strip()

            if not security_code or not trade_type:
                skipped_count += 1
                continue

            settlement_date = _parse_date(row.get("Settlement Date", ""))

            quantity_str = row.get("Quantity", "")
            quantity = float(quantity_str) if quantity_str else None

            avg_price_str = row.get("Average Price", "").replace("$", "").replace(",", "")
            avg_price = float(avg_price_str) if avg_price_str else None

            net_amount = _parse_amount(row.get("Net Amount", ""))
            brokerage = _parse_amount(row.get("Brokerage", ""))
            gst = _parse_amount(row.get("GST", ""))
            tax = _parse_amount(row.get("Tax", ""))

            security_name = row.get("Security", "").strip()

            trades.append(ParsedStockTrade(
                account_number=account_number,
                trade_date=trade_date,
                settlement_date=settlement_date,
                security_name=security_name,
                security_code=security_code,
                trade_type=trade_type,
                quantity=quantity,
                avg_price=avg_price,
                net_amount=net_amount,
                brokerage=brokerage,
                gst=gst,
                tax=tax,
            ))

        return StockParseResult(
            platform_name=self.platform_name,
            account_number=account_number,
            account_name=account_name,
            entity_name=entity_name,
            trades=trades,
            row_count=row_count,
            skipped_count=skipped_count,
            errors=errors,
        )
