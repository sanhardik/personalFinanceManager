"""
Fetch current stock prices using two providers:

  1. Alpaca Market Data API  — US-listed stocks (NYSE / NASDAQ)
     Batch request; credentials: ALPACA_API_KEY + ALPACA_API_SECRET in .env

  2. Twelve Data API         — ASX stocks and anything Alpaca doesn't cover
     Batch request; credential: TWELVE_DATA_API_KEY in .env
     Tries {CODE}/ASX first, falls back to plain {CODE}

Strategy: Alpaca first for all codes → feed misses to Twelve Data.
"""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_ALPACA_URL = "https://data.alpaca.markets/v2/stocks/trades/latest"
_TWELVE_URL = "https://api.twelvedata.com/price"


async def _fetch_alpaca(client: httpx.AsyncClient, codes: list[str]) -> dict[str, float | None]:
    if not settings.ALPACA_API_KEY or not settings.ALPACA_API_SECRET:
        return {c: None for c in codes}
    try:
        resp = await client.get(
            _ALPACA_URL,
            params={"symbols": ",".join(codes)},
            headers={
                "APCA-API-KEY-ID": settings.ALPACA_API_KEY,
                "APCA-API-SECRET-KEY": settings.ALPACA_API_SECRET,
            },
            timeout=15,
        )
        if resp.status_code != 200:
            logger.error("Alpaca %s: %s", resp.status_code, resp.text[:200])
            return {c: None for c in codes}
        trades = resp.json().get("trades", {})
        return {c: float(trades[c]["p"]) if c in trades else None for c in codes}
    except Exception as exc:
        logger.error("Alpaca fetch failed: %s", exc)
        return {c: None for c in codes}


async def _fetch_twelve(client: httpx.AsyncClient, codes: list[str]) -> dict[str, float | None]:
    if not settings.TWELVE_DATA_API_KEY:
        return {c: None for c in codes}

    results: dict[str, float | None] = {c: None for c in codes}

    # Try {CODE}/ASX first (covers all ASX-listed securities)
    asx_symbols = [f"{c}/ASX" for c in codes]
    try:
        resp = await client.get(
            _TWELVE_URL,
            params={"symbol": ",".join(asx_symbols), "apikey": settings.TWELVE_DATA_API_KEY},
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json()
            # Single symbol → {"price": "42.50"} ; multiple → {"BHP/ASX": {"price": ...}, ...}
            if len(codes) == 1:
                price = data.get("price")
                if price:
                    results[codes[0]] = float(price)
            else:
                for c, sym in zip(codes, asx_symbols):
                    entry = data.get(sym, {})
                    price = entry.get("price") if isinstance(entry, dict) else None
                    if price:
                        results[c] = float(price)
    except Exception as exc:
        logger.error("Twelve Data ASX fetch failed: %s", exc)

    # For any still missing, try plain code (catches US stocks not in Alpaca)
    missing = [c for c in codes if results[c] is None]
    if missing:
        try:
            resp = await client.get(
                _TWELVE_URL,
                params={"symbol": ",".join(missing), "apikey": settings.TWELVE_DATA_API_KEY},
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                if len(missing) == 1:
                    price = data.get("price")
                    if price:
                        results[missing[0]] = float(price)
                else:
                    for c in missing:
                        entry = data.get(c, {})
                        price = entry.get("price") if isinstance(entry, dict) else None
                        if price:
                            results[c] = float(price)
        except Exception as exc:
            logger.error("Twelve Data plain fetch failed: %s", exc)

    return results


async def fetch_prices(security_codes: list[str]) -> dict[str, float | None]:
    """
    Return {security_code: price} for each code.
    Tries Alpaca first; feeds any misses to Twelve Data.
    Returns None for codes neither provider covers.
    """
    async with httpx.AsyncClient() as client:
        alpaca = await _fetch_alpaca(client, security_codes)
        missed = [c for c, p in alpaca.items() if p is None]
        if missed:
            twelve = await _fetch_twelve(client, missed)
            alpaca.update(twelve)
    return alpaca
