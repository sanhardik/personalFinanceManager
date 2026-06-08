"""
Fetch current stock prices via the Alpaca Market Data API.

Alpaca covers US-listed equities. ASX-only securities (e.g. PMGOLD, AAA, COL)
will return None and must be entered manually.

Config required in .env:
  ALPACA_API_KEY=<key-id>
  ALPACA_API_SECRET=<secret-key>
"""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_ALPACA_DATA_URL = "https://data.alpaca.markets/v2/stocks/trades/latest"


async def fetch_prices(security_codes: list[str]) -> dict[str, float | None]:
    """
    Return {security_code: price} for each code via Alpaca.
    Returns None for codes Alpaca does not cover (ASX-only, unknown tickers).
    Returns all None immediately if Alpaca credentials are not configured.
    """
    if not settings.ALPACA_API_KEY or not settings.ALPACA_API_SECRET:
        logger.warning("Alpaca credentials not configured — set ALPACA_API_KEY and ALPACA_API_SECRET in .env")
        return {code: None for code in security_codes}

    headers = {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": settings.ALPACA_API_SECRET,
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                _ALPACA_DATA_URL,
                params={"symbols": ",".join(security_codes)},
                headers=headers,
            )

        if resp.status_code == 403:
            logger.error("Alpaca: invalid API credentials (403)")
            return {code: None for code in security_codes}

        if resp.status_code != 200:
            logger.error("Alpaca: unexpected status %s — %s", resp.status_code, resp.text[:200])
            return {code: None for code in security_codes}

        trades = resp.json().get("trades", {})
        return {
            code: float(trades[code]["p"]) if code in trades else None
            for code in security_codes
        }

    except Exception as exc:
        logger.error("Alpaca price fetch failed: %s", exc)
        return {code: None for code in security_codes}
