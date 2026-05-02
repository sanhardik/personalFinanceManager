"""
Pattern extraction for rule learning.

Extracts a merchant/payee pattern from a raw bank transaction description
so that the app can suggest auto-categorisation rules.

Supported description formats (Westpac):
  "COLES 7543 PARRAMATTA 16APR"   → "COLES"
  "NETFLIX.COM 800-599-1743 CA"   → "NETFLIX"
  "SPACESHIP INVEST PTY"          → "SPACESHIP INVEST"
  "BUNNINGS WAREHOUSE AUBURN"     → "BUNNINGS WAREHOUSE"
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
    # Domain/URL suffixes
    "COM", "NET", "ORG", "AU", "WWW",
    # Generic retail words that don't identify a merchant
    "STORE",
}

# How many manual categorisations before a suggestion is auto-promoted to a real rule
AUTO_PROMOTE_THRESHOLD = 3

# Regex for tokens that are purely digits/punctuation (no alpha chars)
_NUMERIC_TOKEN_RE = re.compile(r"^[\d\-\./,;:_]+$")


def extract_merchant_pattern(tx_desc: str) -> str | None:
    """
    Extract a merchant identifier (up to 2 words) from a transaction description.

    Strategy:
    - Split on whitespace and common punctuation
    - Strip non-alpha chars from each token
    - Collect meaningful tokens (≥3 chars, not in skip list) from the start
    - Stop when a purely-numeric original token is encountered (store numbers, dates)
    - Stop when a skip-listed token is encountered after collection has started
    - Return up to 2 collected tokens joined by space, or None if none found

    Examples:
      "COLES 7543 PARRAMATTA 16APR"  → "COLES"         (stops at numeric 7543)
      "BUNNINGS WAREHOUSE AUBURN"    → "BUNNINGS WAREHOUSE"
      "SPACESHIP INVEST PTY LTD"     → "SPACESHIP INVEST" (PTY is in skip list)
      "NETFLIX.COM 800-599-1743 CA"  → "NETFLIX"        (COM is in skip list)
      "TO WOOLWORTHS STORE"          → "WOOLWORTHS"     (STORE is in skip list)
      "CARD PAYMENT THANK YOU"       → None
    """
    tokens = re.split(r"[\s\-\./,;:_]+", tx_desc.upper())

    collected: list[str] = []
    for token in tokens:
        if not token:
            continue

        # Purely-numeric token (store number, date fragment) → stop collecting
        if _NUMERIC_TOKEN_RE.match(token):
            if collected:
                break
            continue

        # Strip non-alpha characters for the clean version
        clean = re.sub(r"[^A-Z]", "", token)

        if not clean:
            # Token had mixed digits/alpha that stripped to nothing meaningful
            if collected:
                break
            continue

        if len(clean) < 3:
            # Very short token — stop if collecting, skip otherwise
            if collected:
                break
            continue

        if clean in _SKIP_TOKENS:
            # Boilerplate token — stop if collecting, skip if not yet started
            if collected:
                break
            continue

        collected.append(clean)
        if len(collected) == 2:
            break

    return " ".join(collected) if collected else None
