"""
Fetch current stock prices via yfinance + curl_cffi Chrome impersonation.

curl_cffi makes requests look like real Chrome, bypassing Yahoo Finance's
bot detection that blocks plain Python requests on Raspberry Pi.

Strategy per security:
  1. Try {CODE}.AX  (ASX-listed) → currency = "AUD"
  2. Fall back to plain {CODE}  (US-listed) → currency = "USD"

FX rate: AUDUSD=X ticker gives how many USD per 1 AUD.
  To convert USD price to AUD: price_aud = price_usd / aud_usd_rate
  Fallback: 0.65 if yfinance cannot fetch it.

No API key required.
"""
import asyncio
import logging

FALLBACK_AUD_USD_RATE = 0.65

logger = logging.getLogger(__name__)


def _fetch_price_sync(code: str) -> tuple[float, str] | None:
    """
    Synchronous lookup — runs in a thread pool to avoid blocking the event loop.

    Returns (price, currency) where currency is "AUD" if the .AX ticker succeeded,
    or "USD" if the plain ticker succeeded. Returns None if neither works.
    """
    try:
        import yfinance as yf
        from curl_cffi import requests as cffi_requests
    except ImportError as e:
        logger.error("Missing dependency: %s", e)
        return None

    session = cffi_requests.Session(impersonate="chrome")

    for ticker_sym, currency in [(f"{code}.AX", "AUD"), (code, "USD")]:
        try:
            hist = yf.Ticker(ticker_sym, session=session).history(period="2d")
            if not hist.empty:
                return float(hist["Close"].iloc[-1]), currency
        except Exception as exc:
            logger.debug("yfinance %s: %s", ticker_sym, exc)

    return None


def _fetch_aud_usd_rate_sync() -> float:
    """
    Fetch the AUD/USD exchange rate synchronously via yfinance.

    Returns the rate (e.g. 0.65 means 1 AUD = 0.65 USD).
    Falls back to FALLBACK_AUD_USD_RATE on any error.
    """
    try:
        import yfinance as yf
        from curl_cffi import requests as cffi_requests
    except ImportError:
        return FALLBACK_AUD_USD_RATE

    try:
        session = cffi_requests.Session(impersonate="chrome")
        hist = yf.Ticker("AUDUSD=X", session=session).history(period="2d")
        if not hist.empty:
            return float(hist["Close"].iloc[-1])
    except Exception as exc:
        logger.warning("Could not fetch AUDUSD=X: %s — using fallback %.4f", exc, FALLBACK_AUD_USD_RATE)

    return FALLBACK_AUD_USD_RATE


async def fetch_aud_usd_rate() -> float:
    """Async wrapper for the AUD/USD rate fetch."""
    return await asyncio.to_thread(_fetch_aud_usd_rate_sync)


async def fetch_prices(
    security_codes: list[str],
) -> dict[str, tuple[float, str] | None]:
    """
    Return {security_code: (price, currency)} for each code.

    currency is "AUD" when the .AX ticker succeeded, "USD" for US-listed.
    None when no price could be found.

    Fetches sequentially with a 2s delay between requests to avoid rate limiting.
    """
    results: dict[str, tuple[float, str] | None] = {}
    for i, code in enumerate(security_codes):
        if i > 0:
            await asyncio.sleep(2)
        results[code] = await asyncio.to_thread(_fetch_price_sync, code)
    return results
