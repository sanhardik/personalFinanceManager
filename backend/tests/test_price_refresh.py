"""
Tests for POST /investments/{account_id}/refresh-prices.

yfinance is mocked throughout — these tests never hit the internet.
"""
import io
from unittest.mock import patch, AsyncMock

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


# ── price_fetcher unit tests ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fetch_prices_returns_dict_of_prices():
    """fetch_prices resolves per-code coroutines and returns {code: price}."""
    from app.services.price_fetcher import fetch_prices

    async def fake_to_thread(fn, code):
        return {"PMGOLD": 52.10, "IVV": 89.50}.get(code)

    with patch("app.services.price_fetcher.asyncio.to_thread", side_effect=fake_to_thread):
        result = await fetch_prices(["PMGOLD", "IVV"])

    assert result["PMGOLD"] == pytest.approx(52.10)
    assert result["IVV"] == pytest.approx(89.50)


@pytest.mark.asyncio
async def test_fetch_prices_returns_none_for_unknown():
    from app.services.price_fetcher import fetch_prices

    async def fake_to_thread(fn, code):
        return None

    with patch("app.services.price_fetcher.asyncio.to_thread", side_effect=fake_to_thread):
        result = await fetch_prices(["UNKNOWN"])

    assert result["UNKNOWN"] is None


@pytest.mark.asyncio
async def test_fetch_price_sync_tries_ax_suffix_first():
    """_fetch_price_sync tries CODE.AX before plain CODE."""
    import yfinance as yf
    from app.services.price_fetcher import _fetch_price_sync
    import pandas as pd

    tickers_called = []

    class FakeTicker:
        def __init__(self, sym):
            self.sym = sym
            tickers_called.append(sym)

        def history(self, period):
            if self.sym == "PMGOLD.AX":
                return pd.DataFrame({"Close": [52.10]})
            return pd.DataFrame()

    with patch("yfinance.Ticker", FakeTicker):
        price = _fetch_price_sync("PMGOLD")

    assert price == pytest.approx(52.10)
    assert tickers_called[0] == "PMGOLD.AX"


@pytest.mark.asyncio
async def test_fetch_price_sync_falls_back_to_plain_ticker():
    """_fetch_price_sync falls back to plain ticker when .AX has no data."""
    import pandas as pd
    from app.services.price_fetcher import _fetch_price_sync

    class FakeTicker:
        def __init__(self, sym):
            self.sym = sym

        def history(self, period):
            if self.sym == "IVV":
                return pd.DataFrame({"Close": [610.25]})
            return pd.DataFrame()

    with patch("yfinance.Ticker", FakeTicker):
        price = _fetch_price_sync("IVV")

    assert price == pytest.approx(610.25)


# ── refresh-prices endpoint tests ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_refresh_prices_updates_holdings(client: AsyncClient):
    """POST /investments/{id}/refresh-prices saves prices and returns updated holdings."""
    acc_id = await _upload_superhero(client)

    async def fake_fetch_prices(codes):
        return {c: 55.00 for c in codes}

    with patch("app.routers.investments.fetch_prices", side_effect=fake_fetch_prices):
        resp = await client.post(f"/investments/{acc_id}/refresh-prices")

    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"] > 0
    assert data["failed"] == []
    assert len(data["holdings"]) > 0
    # current_price should now be set on holdings
    pmgold = next((h for h in data["holdings"] if h["security_code"] == "PMGOLD"), None)
    assert pmgold is not None
    assert pmgold["current_price"] == pytest.approx(55.00)


@pytest.mark.asyncio
async def test_refresh_prices_partial_failure(client: AsyncClient):
    """Failed tickers are listed in 'failed'; successful ones are saved."""
    acc_id = await _upload_superhero(client)

    async def fake_fetch_prices(codes):
        prices = {}
        for c in codes:
            prices[c] = 50.00 if c == "PMGOLD" else None
        return prices

    with patch("app.routers.investments.fetch_prices", side_effect=fake_fetch_prices):
        resp = await client.post(f"/investments/{acc_id}/refresh-prices")

    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"] == 1
    assert "PMGOLD" not in data["failed"]
    # All other codes should be in failed
    assert len(data["failed"]) > 0


@pytest.mark.asyncio
async def test_refresh_prices_404_unknown_account(client: AsyncClient):
    async def fake_fetch_prices(codes):
        return {}

    with patch("app.routers.investments.fetch_prices", side_effect=fake_fetch_prices):
        resp = await client.post("/investments/9999/refresh-prices")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_refresh_prices_404_no_trades(client: AsyncClient, test_session_factory):
    """Returns 404 when account has no stock trades."""
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
    """Response shape: updated, failed, results[{security_code, price, error}], holdings."""
    acc_id = await _upload_superhero(client)

    async def fake_fetch_prices(codes):
        return {c: 42.00 for c in codes}

    with patch("app.routers.investments.fetch_prices", side_effect=fake_fetch_prices):
        resp = await client.post(f"/investments/{acc_id}/refresh-prices")

    data = resp.json()
    assert "updated" in data
    assert "failed" in data
    assert "results" in data
    assert "holdings" in data
    for r in data["results"]:
        assert "security_code" in r
        assert "price" in r
