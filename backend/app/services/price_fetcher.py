"""
Fetch current stock prices from Yahoo Finance via yfinance.

ASX securities are tried with ".AX" suffix first; US-listed fall back to plain ticker.
All yfinance I/O is synchronous, so calls are dispatched via asyncio.to_thread.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


def _fetch_price_sync(code: str) -> float | None:
    """Synchronous price lookup — runs in a thread pool."""
    try:
        import yfinance as yf
    except ImportError:
        logger.error("yfinance is not installed")
        return None

    for ticker_sym in [f"{code}.AX", code]:
        try:
            hist = yf.Ticker(ticker_sym).history(period="2d")
            if not hist.empty:
                return float(hist["Close"].iloc[-1])
        except Exception as exc:
            logger.debug("yfinance %s: %s", ticker_sym, exc)
    return None


async def fetch_prices(security_codes: list[str]) -> dict[str, float | None]:
    """
    Return {security_code: price} for each code.
    Price is None when the ticker cannot be resolved.
    """
    tasks = {code: asyncio.to_thread(_fetch_price_sync, code) for code in security_codes}
    results: dict[str, float | None] = {}
    for code, coro in tasks.items():
        results[code] = await coro
    return results
