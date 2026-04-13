"""
Parser registry — auto-detects which bank parser to use.

New bank parsers are registered here. The detect_parser() function
reads the CSV header and returns the appropriate parser.
"""

from app.parsers.base import BankParser
from app.parsers.macquarie import MacquarieParser
from app.parsers.nab import NABParser
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
