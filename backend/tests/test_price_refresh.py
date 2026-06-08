"""
Tests for POST /investments/{account_id}/refresh-prices.

Network calls are mocked — these tests never hit the internet.
"""
import io
from unittest.mock import MagicMock, patch, AsyncMock

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


def _alpaca_response(prices: dict[str, float]):
    """Build a mock httpx.Response that returns Alpaca-format trade data."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "trades": {code: {"p": price} for code, price in prices.items()}
    }
    return mock_resp


# ── price_fetcher unit tests ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fetch_prices_returns_dict_of_prices():
    """fetch_prices returns {code: price} from Alpaca trade data."""
    from app.services.price_fetcher import fetch_prices

    mock_resp = _alpaca_response({"PMGOLD": 52.10, "IVV": 89.50})

    with patch("app.config.settings.ALPACA_API_KEY", "test-key"), \
         patch("app.config.settings.ALPACA_API_SECRET", "test-secret"), \
         patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await fetch_prices(["PMGOLD", "IVV"])

    assert result["PMGOLD"] == pytest.approx(52.10)
    assert result["IVV"] == pytest.approx(89.50)


@pytest.mark.asyncio
async def test_fetch_prices_returns_none_when_no_credentials():
    """fetch_prices returns all None when Alpaca keys are not configured."""
    from app.services.price_fetcher import fetch_prices

    with patch("app.services.price_fetcher.settings") as mock_settings:
        mock_settings.ALPACA_API_KEY = ""
        mock_settings.ALPACA_API_SECRET = ""
        result = await fetch_prices(["PMGOLD", "IVV"])

    assert result == {"PMGOLD": None, "IVV": None}


@pytest.mark.asyncio
async def test_fetch_prices_returns_none_for_unknown_ticker():
    """Tickers not in Alpaca response get None (e.g. ASX-only stocks)."""
    from app.services.price_fetcher import fetch_prices

    mock_resp = _alpaca_response({"IVV": 540.00})  # PMGOLD not returned

    with patch("app.config.settings.ALPACA_API_KEY", "test-key"), \
         patch("app.config.settings.ALPACA_API_SECRET", "test-secret"), \
         patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await fetch_prices(["PMGOLD", "IVV"])

    assert result["IVV"] == pytest.approx(540.00)
    assert result["PMGOLD"] is None


@pytest.mark.asyncio
async def test_fetch_prices_handles_403():
    """Returns all None on invalid credentials."""
    from app.services.price_fetcher import fetch_prices

    mock_resp = MagicMock()
    mock_resp.status_code = 403

    with patch("app.config.settings.ALPACA_API_KEY", "bad-key"), \
         patch("app.config.settings.ALPACA_API_SECRET", "bad-secret"), \
         patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await fetch_prices(["PMGOLD"])

    assert result["PMGOLD"] is None


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
    pmgold = next((h for h in data["holdings"] if h["security_code"] == "PMGOLD"), None)
    assert pmgold is not None
    assert pmgold["current_price"] == pytest.approx(55.00)


@pytest.mark.asyncio
async def test_refresh_prices_partial_failure(client: AsyncClient):
    """Failed tickers (not in Alpaca) are listed in 'failed'."""
    acc_id = await _upload_superhero(client)

    async def fake_fetch_prices(codes):
        return {c: (50.00 if c == "PMGOLD" else None) for c in codes}

    with patch("app.routers.investments.fetch_prices", side_effect=fake_fetch_prices):
        resp = await client.post(f"/investments/{acc_id}/refresh-prices")

    assert resp.status_code == 200
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
    """Returns 404 when account exists but has no stock trades."""
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
    """Response has updated, failed, results, and holdings fields."""
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
