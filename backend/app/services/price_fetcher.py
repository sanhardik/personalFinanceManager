"""
Fetch current stock prices via yfinance + curl_cffi Chrome impersonation.

curl_cffi makes requests look like real Chrome, bypassing Yahoo Finance's
bot detection that blocks plain Python requests on Raspberry Pi.

Strategy:
  1. Try {CODE}.AX  (ASX-listed)
  2. Fall back to plain {CODE}  (US-listed)

No API key required.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


def _fetch_price_sync(code: str) -> float | None:
    """Synchronous lookup — runs in a thread pool to avoid blocking the event loop."""
    try:
        import yfinance as yf
        from curl_cffi import requests as cffi_requests
    except ImportError as e:
        logger.error("Missing dependency: %s", e)
        return None

    session = cffi_requests.Session(impersonate="chrome")

    for ticker_sym in [f"{code}.AX", code]:
        try:
            hist = yf.Ticker(ticker_sym, session=session).history(period="2d")
            if not hist.empty:
                return float(hist["Close"].iloc[-1])
        except Exception as exc:
            logger.debug("yfinance %s: %s", ticker_sym, exc)

    return None


async def fetch_prices(security_codes: list[str]) -> dict[str, float | None]:
    """
    Return {security_code: price} for each code.
    Fetches sequentially with a 2s delay between requests to avoid rate limiting.
    """
    results: dict[str, float | None] = {}
    for i, code in enumerate(security_codes):
        if i > 0:
            await asyncio.sleep(2)
        results[code] = await asyncio.to_thread(_fetch_price_sync, code)
    return results
