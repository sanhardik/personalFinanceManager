"""
Parser registry — auto-detects which bank parser to use.

New bank parsers are registered here. The detect_parser() function
reads the CSV header and returns the appropriate parser.
"""

from app.parsers.base import BankParser, StockParseResult
from app.parsers.macquarie import MacquarieParser
from app.parsers.nab import NABParser
from app.parsers.superhero import SuperheroParser
from app.parsers.superhero_cash import SuperheroCashParser
from app.parsers.westpac import WestpacParser

# Register all parsers here — order matters (first match wins)
PARSERS: list[BankParser] = [
    WestpacParser(),
    NABParser(),
    MacquarieParser(),
]


def detect_parser(header_line: str) -> BankParser | None:
    """
    Auto-detect which parser handles this CSV based on its header.

    Returns the parser instance, or None if no parser matches.
    """
    for parser in PARSERS:
        if parser.can_parse(header_line):
            return parser
    return None


def get_supported_banks() -> list[str]:
    """Return list of supported bank names."""
    return [p.bank_name for p in PARSERS]


_SUPERHERO_PARSER = SuperheroParser()
_SUPERHERO_CASH_PARSER = SuperheroCashParser()


def detect_cash_parser(content: str) -> SuperheroCashParser | None:
    """
    Detect a full-content bank CSV parser (e.g. Superhero Cash Statement).

    These parsers operate on full file content rather than just the header line
    because they have multi-row metadata blocks before the data header.
    Returns the parser instance, or None if no parser matches.
    """
    if _SUPERHERO_CASH_PARSER.can_parse(content):
        return _SUPERHERO_CASH_PARSER
    return None


def detect_stock_parser(content: str) -> SuperheroParser | None:
    """
    Auto-detect a stock/brokerage CSV parser based on full file content.

    Returns the parser instance, or None if no parser matches.
    Currently only Superhero is supported.
    """
    if _SUPERHERO_PARSER.can_parse(content):
        return _SUPERHERO_PARSER
    return None


def get_bank_info() -> list[dict]:
    """Return name, description, and required headers for each supported bank."""
    return [
        {
            "name": p.bank_name,
            "description": p.description,
            "required_headers": p.required_headers,
            "platform_type": "bank",
        }
        for p in PARSERS
    ]


def get_all_platform_info() -> list[dict]:
    """Return bank parsers + stock/brokerage parsers for the upload UI."""
    platforms = get_bank_info()
    # Superhero Transaction Statement (stock trades)
    platforms.append({
        "name": _SUPERHERO_PARSER.platform_name,
        "description": "Superhero brokerage — investment account trade history",
        "required_headers": ["Transaction Date", "Security Code", "Transaction Type", "Net Amount"],
        "platform_type": "stock",
    })
    # Superhero Cash Statement (AUD cash account)
    platforms.append({
        "name": "Superhero Cash",
        "description": _SUPERHERO_CASH_PARSER.description,
        "required_headers": _SUPERHERO_CASH_PARSER.required_headers,
        "platform_type": "bank",
    })
    return platforms
