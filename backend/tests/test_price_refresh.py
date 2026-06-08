"""
Tests for the price fetcher (yfinance + curl_cffi) and POST /investments/{id}/refresh-prices.
Network calls are mocked throughout.
"""
import io
import pandas as pd
from unittest.mock import patch, MagicMock

import pytest
from httpx import AsyncClient


FIXTURES_DIR = __import__("os").path.join(__import__("os").path.dirname(__file__), "fixtures")


def _load_fixture(name):
    with open(__import__("os").path.join(FIXTURES_DIR, name)) as f:
        return f.read()


async def _upload_superhero(client: AsyncClient):
    content = _load_fixture("superhero_sample.csv")
    await client.post(
        "/upload",
        files={"file": ("superhero_sample.csv", io.BytesIO(content.encode()), "text/csv")},
    )
    accounts = (await client.get("/investments")).json()
    return next(a["id"] for a in accounts if a["bank_name"] == "Superhero")


# ── _fetch_price_sync unit tests ──────────────────────────────────────────────

def test_fetch_price_sync_tries_ax_suffix_first():
    """Tries CODE.AX before plain CODE; returns (price, 'AUD') on .AX success."""
    from app.services.price_fetcher import _fetch_price_sync

    tickers_tried = []

    class FakeTicker:
        def __init__(self, sym, session=None):
            tickers_tried.append(sym)

        def history(self, period):
            if tickers_tried[-1] == "PMGOLD.AX":
                return pd.DataFrame({"Close": [52.10]})
            return pd.DataFrame()

    with patch("yfinance.Ticker", FakeTicker), \
         patch("curl_cffi.requests.Session"):
        result = _fetch_price_sync("PMGOLD")

    assert result is not None
    price, currency = result
    assert price == pytest.approx(52.10)
    assert currency == "AUD"
    assert tickers_tried[0] == "PMGOLD.AX"


def test_fetch_price_sync_falls_back_to_plain_ticker():
    """Falls back to plain CODE when .AX returns no data; returns (price, 'USD')."""
    from app.services.price_fetcher import _fetch_price_sync

    class FakeTicker:
        def __init__(self, sym, session=None):
            self.sym = sym

        def history(self, period):
            return pd.DataFrame({"Close": [610.25]}) if self.sym == "IVV" else pd.DataFrame()

    with patch("yfinance.Ticker", FakeTicker), \
         patch("curl_cffi.requests.Session"):
        result = _fetch_price_sync("IVV")

    assert result is not None
    price, currency = result
    assert price == pytest.approx(610.25)
    assert currency == "USD"


def test_fetch_price_sync_returns_none_when_not_found():
    from app.services.price_fetcher import _fetch_price_sync

    class FakeTicker:
        def __init__(self, sym, session=None):
            pass

        def history(self, period):
            return pd.DataFrame()

    with patch("yfinance.Ticker", FakeTicker), \
         patch("curl_cffi.requests.Session"):
        result = _fetch_price_sync("UNKNOWN")

    assert result is None


# ── fetch_prices async wrapper ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fetch_prices_returns_dict():
    from app.services.price_fetcher import fetch_prices

    async def fake_to_thread(fn, code):
        return {"PMGOLD": (52.10, "AUD"), "IVV": (610.25, "USD")}.get(code)

    with patch("app.services.price_fetcher.asyncio.to_thread", side_effect=fake_to_thread):
        result = await fetch_prices(["PMGOLD", "IVV"])

    assert result["PMGOLD"] == (pytest.approx(52.10), "AUD")
    assert result["IVV"] == (pytest.approx(610.25), "USD")


@pytest.mark.asyncio
async def test_fetch_prices_returns_none_for_unknown():
    from app.services.price_fetcher import fetch_prices

    async def fake_to_thread(fn, code):
        return None

    with patch("app.services.price_fetcher.asyncio.to_thread", side_effect=fake_to_thread):
        result = await fetch_prices(["UNKNOWN"])

    assert result["UNKNOWN"] is None


# ── endpoint tests ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_refresh_prices_updates_holdings(client: AsyncClient):
    acc_id = await _upload_superhero(client)

    async def fake_fetch(codes):
        return {c: (55.00, "AUD") for c in codes}

    with patch("app.routers.investments.fetch_prices", side_effect=fake_fetch):
        resp = await client.post(f"/investments/{acc_id}/refresh-prices")

    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"] > 0
    assert data["failed"] == []
    pmgold = next(h for h in data["holdings"] if h["security_code"] == "PMGOLD")
    assert pmgold["current_price"] == pytest.approx(55.00)


@pytest.mark.asyncio
async def test_refresh_prices_partial_failure(client: AsyncClient):
    acc_id = await _upload_superhero(client)

    async def fake_fetch(codes):
        return {c: ((50.00, "AUD") if c == "PMGOLD" else None) for c in codes}

    with patch("app.routers.investments.fetch_prices", side_effect=fake_fetch):
        resp = await client.post(f"/investments/{acc_id}/refresh-prices")

    data = resp.json()
    assert data["updated"] == 1
    assert "PMGOLD" not in data["failed"]
    assert len(data["failed"]) > 0


@pytest.mark.asyncio
async def test_refresh_prices_404_unknown_account(client: AsyncClient):
    resp = await client.post("/investments/9999/refresh-prices")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_refresh_prices_404_no_trades(client: AsyncClient, test_session_factory):
    from app.models import Account

    async with test_session_factory() as session:
        acc = Account(
            account_number="EMPTY-INVEST-99",
            account_name="Empty Investment",
            bank_name="TestBroker",
            account_type="investment",
        )
        session.add(acc)
        await session.commit()
        await session.refresh(acc)
        acc_id = acc.id

    resp = await client.post(f"/investments/{acc_id}/refresh-prices")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_refresh_prices_result_shape(client: AsyncClient):
    acc_id = await _upload_superhero(client)

    async def fake_fetch(codes):
        return {c: (42.00, "AUD") for c in codes}

    with patch("app.routers.investments.fetch_prices", side_effect=fake_fetch):
        resp = await client.post(f"/investments/{acc_id}/refresh-prices")

    data = resp.json()
    for key in ("updated", "failed", "results", "holdings"):
        assert key in data
    for r in data["results"]:
        assert "security_code" in r and "price" in r and "currency" in r
