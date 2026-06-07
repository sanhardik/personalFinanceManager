"""
Tests for POST /investments/{account_id}/refresh-prices.

Network calls are mocked — these tests never hit the internet.
"""
import io
from unittest.mock import AsyncMock, MagicMock, patch

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


def _mock_yahoo_response(price: float):
    """Build a mock httpx.Response that returns the given price."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "chart": {"result": [{"meta": {"regularMarketPrice": price}}]}
    }
    return mock_resp


def _mock_yahoo_empty():
    mock_resp = MagicMock()
    mock_resp.status_code = 429
    return mock_resp


# ── price_fetcher unit tests ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fetch_prices_returns_dict_of_prices():
    """fetch_prices returns {code: price} when Yahoo responds successfully."""
    from app.services.price_fetcher import fetch_prices

    async def fake_fetch_one(client, code):
        return {"PMGOLD": 52.10, "IVV": 89.50}.get(code)

    with patch("app.services.price_fetcher._fetch_one", side_effect=fake_fetch_one):
        result = await fetch_prices(["PMGOLD", "IVV"])

    assert result["PMGOLD"] == pytest.approx(52.10)
    assert result["IVV"] == pytest.approx(89.50)


@pytest.mark.asyncio
async def test_fetch_prices_returns_none_for_unknown():
    from app.services.price_fetcher import fetch_prices

    async def fake_fetch_one(client, code):
        return None

    with patch("app.services.price_fetcher._fetch_one", side_effect=fake_fetch_one):
        result = await fetch_prices(["UNKNOWN"])

    assert result["UNKNOWN"] is None


@pytest.mark.asyncio
async def test_fetch_one_tries_ax_suffix_first():
    """_fetch_one tries CODE.AX before plain CODE."""
    import httpx
    from app.services.price_fetcher import _fetch_one

    tickers_tried = []

    async def fake_get(url, **kwargs):
        ticker = url.split("/")[-1]
        tickers_tried.append(ticker)
        if ticker == "PMGOLD.AX":
            return _mock_yahoo_response(52.10)
        return _mock_yahoo_empty()

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = fake_get

    price = await _fetch_one(mock_client, "PMGOLD")

    assert price == pytest.approx(52.10)
    assert tickers_tried[0] == "PMGOLD.AX"


@pytest.mark.asyncio
async def test_fetch_one_falls_back_to_plain_ticker():
    """_fetch_one returns price from plain ticker when .AX has no data."""
    import httpx
    from app.services.price_fetcher import _fetch_one

    async def fake_get(url, **kwargs):
        ticker = url.split("/")[-1]
        if ticker == "IVV":
            return _mock_yahoo_response(610.25)
        return _mock_yahoo_empty()

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = fake_get

    price = await _fetch_one(mock_client, "IVV")
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
    pmgold = next((h for h in data["holdings"] if h["security_code"] == "PMGOLD"), None)
    assert pmgold is not None
    assert pmgold["current_price"] == pytest.approx(55.00)


@pytest.mark.asyncio
async def test_refresh_prices_partial_failure(client: AsyncClient):
    """Failed tickers are listed in 'failed'; successful ones are saved."""
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
    async def fake_fetch_prices(codes):
        return {}

    with patch("app.routers.investments.fetch_prices", side_effect=fake_fetch_prices):
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
