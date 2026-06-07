"""
Fetch current stock prices from Yahoo Finance via direct HTTP (no yfinance library).

Uses the v8/finance/chart endpoint with browser-like headers to avoid rate limiting.
ASX securities are tried with ".AX" suffix first; falls back to plain ticker for US-listed.
"""
import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

_YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
_YAHOO_URL_FALLBACK = "https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, */*",
    "Accept-Language": "en-AU,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
}


async def _fetch_one(client: httpx.AsyncClient, code: str) -> float | None:
    """Try CODE.AX then CODE. Retries once after 3s on 429. Returns regularMarketPrice or None."""
    for ticker in [f"{code}.AX", code]:
        for base_url in [_YAHOO_URL, _YAHOO_URL_FALLBACK]:
            url = base_url.format(ticker=ticker)
            for attempt in range(2):
                try:
                    resp = await client.get(
                        url,
                        params={"interval": "1d", "range": "2d"},
                        headers=_HEADERS,
                        timeout=15,
                    )
                    if resp.status_code == 429:
                        if attempt == 0:
                            await asyncio.sleep(3)
                            continue
                        break
                    if resp.status_code != 200:
                        break
                    data = resp.json()
                    price = (
                        data.get("chart", {})
                        .get("result", [{}])[0]
                        .get("meta", {})
                        .get("regularMarketPrice")
                    )
                    if price is not None:
                        return float(price)
                    break
                except Exception as exc:
                    logger.debug("price fetch %s: %s", ticker, exc)
                    break
    return None


async def fetch_prices(security_codes: list[str]) -> dict[str, float | None]:
    """
    Return {security_code: price} for each code.
    Fetches sequentially with a small delay to avoid Yahoo Finance rate limits.
    """
    async with httpx.AsyncClient() as client:
        results: dict[str, float | None] = {}
        for i, code in enumerate(security_codes):
            if i > 0:
                await asyncio.sleep(1.5)
            results[code] = await _fetch_one(client, code)
    return results
