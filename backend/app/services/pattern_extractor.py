"""
Pattern extraction for rule learning.

Extracts a merchant/payee pattern from a raw bank transaction description
so that the app can suggest auto-categorisation rules.

Supported description formats (Westpac):
  "COLES 7543 PARRAMATTA 16APR"   → "COLES"
  "NETFLIX.COM 800-599-1743 CA"   → "NETFLIX"
  "SPACESHIP INVEST PTY"          → "SPACESHIP"
  "CARD PAYMENT THANK YOU"        → None  (all tokens skipped)
"""

import re

# Tokens that appear in bank boilerplate — not useful as merchant identifiers
_SKIP_TOKENS = {
    "CARD", "PAYMENT", "TRANSFER", "DIRECT", "DEBIT", "CREDIT",
    "ONLINE", "PURCHASE", "RECURRING", "AUTO", "DEP", "FROM",
    "TO", "AT", "THE", "AND", "OR", "IN", "OF", "FOR",
    "INTERNET", "BANKING", "VISA", "EFTPOS", "POS", "MOBILE",
    "APP", "BPAY", "PAY", "BANK", "BSB", "REF", "TXN",
    "THANK", "YOU", "AUS", "PTY", "LTD", "INC",
}

# How many manual categorisations before a suggestion is auto-promoted to a real rule
AUTO_PROMOTE_THRESHOLD = 3


def extract_merchant_pattern(tx_desc: str) -> str | None:
    """
    Extract a short merchant identifier from a transaction description.

    Splits on whitespace / punctuation, strips non-alpha chars from each token,
    skips boilerplate words, and returns the first candidate that is ≥ 3 chars.

    Returns None if no suitable token is found.
    """
    # Split on whitespace and common punctuation
    tokens = re.split(r"[\s\-\./,;:_]+", tx_desc.upper())

    for token in tokens:
        # Keep only A-Z characters
        clean = re.sub(r"[^A-Z]", "", token)
        if len(clean) >= 3 and clean not in _SKIP_TOKENS:
            return clean

    return None
