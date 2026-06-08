"""
Tests for the price fetcher (Alpaca + Twelve Data) and POST /investments/{id}/refresh-prices.
Network calls are mocked throughout.
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


def _make_alpaca_resp(prices: dict[str, float]):
    m = MagicMock()
    m.status_code = 200
    m.json.return_value = {"trades": {c: {"p": p} for c, p in prices.items()}}
    return m


def _make_twelve_resp(prices: dict[str, float], symbols: list[str]):
    """Simulate Twelve Data batch response keyed by 'CODE/ASX'."""
    m = MagicMock()
    m.status_code = 200
    if len(symbols) == 1:
        price = next(iter(prices.values()), None)
        m.json.return_value = {"price": str(price)} if price else {}
    else:
        m.json.return_value = {sym: {"price": str(p)} for sym, p in zip(symbols, prices.values())}
    return m


# ── _fetch_alpaca ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_alpaca_returns_prices():
    from app.services.price_fetcher import _fetch_alpaca
    import httpx

    resp = _make_alpaca_resp({"IVV": 540.0, "BHP": 42.0})
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=resp)

    with patch("app.services.price_fetcher.settings") as s:
        s.ALPACA_API_KEY = "key"
        s.ALPACA_API_SECRET = "secret"
        result = await _fetch_alpaca(mock_client, ["IVV", "BHP"])

    assert result["IVV"] == pytest.approx(540.0)
    assert result["BHP"] == pytest.approx(42.0)


@pytest.mark.asyncio
async def test_alpaca_returns_none_when_no_credentials():
    from app.services.price_fetcher import _fetch_alpaca
    import httpx

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    with patch("app.services.price_fetcher.settings") as s:
        s.ALPACA_API_KEY = ""
        s.ALPACA_API_SECRET = ""
        result = await _fetch_alpaca(mock_client, ["IVV"])

    assert result["IVV"] is None
    mock_client.get.assert_not_called()


@pytest.mark.asyncio
async def test_alpaca_returns_none_for_unknown_ticker():
    from app.services.price_fetcher import _fetch_alpaca
    import httpx

    resp = _make_alpaca_resp({"IVV": 540.0})  # PMGOLD not in response
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=resp)

    with patch("app.services.price_fetcher.settings") as s:
        s.ALPACA_API_KEY = "key"
        s.ALPACA_API_SECRET = "secret"
        result = await _fetch_alpaca(mock_client, ["IVV", "PMGOLD"])

    assert result["IVV"] == pytest.approx(540.0)
    assert result["PMGOLD"] is None


# ── _fetch_twelve ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_twelve_returns_asx_prices():
    from app.services.price_fetcher import _fetch_twelve
    import httpx

    asx_resp = _make_twelve_resp({"PMGOLD": 52.1, "AAA": 50.0}, ["PMGOLD/ASX", "AAA/ASX"])
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=asx_resp)

    with patch("app.services.price_fetcher.settings") as s:
        s.TWELVE_DATA_API_KEY = "key"
        result = await _fetch_twelve(mock_client, ["PMGOLD", "AAA"])

    assert result["PMGOLD"] == pytest.approx(52.1)
    assert result["AAA"] == pytest.approx(50.0)


@pytest.mark.asyncio
async def test_twelve_returns_none_when_no_key():
    from app.services.price_fetcher import _fetch_twelve
    import httpx

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    with patch("app.services.price_fetcher.settings") as s:
        s.TWELVE_DATA_API_KEY = ""
        result = await _fetch_twelve(mock_client, ["PMGOLD"])

    assert result["PMGOLD"] is None
    mock_client.get.assert_not_called()


# ── fetch_prices (combined) ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fetch_prices_alpaca_first_twelve_for_misses():
    """US stocks resolved by Alpaca; ASX stocks fall through to Twelve Data."""
    from app.services.price_fetcher import fetch_prices

    async def fake_alpaca(client, codes):
        return {"IVV": 540.0, "PMGOLD": None}

    async def fake_twelve(client, codes):
        return {"PMGOLD": 52.1}

    with patch("app.services.price_fetcher._fetch_alpaca", side_effect=fake_alpaca), \
         patch("app.services.price_fetcher._fetch_twelve", side_effect=fake_twelve):
        result = await fetch_prices(["IVV", "PMGOLD"])

    assert result["IVV"] == pytest.approx(540.0)
    assert result["PMGOLD"] == pytest.approx(52.1)


@pytest.mark.asyncio
async def test_fetch_prices_skips_twelve_when_alpaca_covers_all():
    """Twelve Data is not called when Alpaca returns prices for all codes."""
    from app.services.price_fetcher import fetch_prices

    async def fake_alpaca(client, codes):
        return {c: 100.0 for c in codes}

    with patch("app.services.price_fetcher._fetch_alpaca", side_effect=fake_alpaca) as mock_a, \
         patch("app.services.price_fetcher._fetch_twelve") as mock_t:
        await fetch_prices(["IVV", "BHP"])

    mock_t.assert_not_called()


# ── endpoint tests ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_refresh_prices_updates_holdings(client: AsyncClient):
    acc_id = await _upload_superhero(client)

    async def fake_fetch(codes):
        return {c: 55.00 for c in codes}

    with patch("app.routers.investments.fetch_prices", side_effect=fake_fetch):
        resp = await client.post(f"/investments/{acc_id}/refresh-prices")

    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"] > 0
    assert data["failed"] == []
    pmgold = next((h for h in data["holdings"] if h["security_code"] == "PMGOLD"), None)
    assert pmgold["current_price"] == pytest.approx(55.00)


@pytest.mark.asyncio
async def test_refresh_prices_partial_failure(client: AsyncClient):
    acc_id = await _upload_superhero(client)

    async def fake_fetch(codes):
        return {c: (50.00 if c == "PMGOLD" else None) for c in codes}

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
        return {c: 42.00 for c in codes}

    with patch("app.routers.investments.fetch_prices", side_effect=fake_fetch):
        resp = await client.post(f"/investments/{acc_id}/refresh-prices")

    data = resp.json()
    for key in ("updated", "failed", "results", "holdings"):
        assert key in data
    for r in data["results"]:
        assert "security_code" in r and "price" in r
