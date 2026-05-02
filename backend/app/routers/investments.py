"""
Investment account endpoints + Superhero stock holdings analytics.

Routes:
  GET   /investments                             — list investment accounts
  PATCH /investments/{id}/value                  — update current portfolio value
  GET   /investments/{id}/trades                 — list raw stock trades for an account
  GET   /investments/{id}/holdings               — aggregated holdings with P&L + ARR
  GET   /investments/{id}/dividends              — monthly dividend breakdown by security
  GET   /investments/{id}/performance            — monthly cost-basis vs portfolio-value
  PATCH /investments/holdings/{id}/{code}/price  — update current price for a security
"""
import math
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import asc, case, desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Account, StockTrade, StockValuation, Transaction
from app.schemas import (
    DividendRow,
    HoldingPriceUpdate,
    HoldingRow,
    InvestmentResponse,
    PerformanceRow,
    StockTradeResponse,
)

router = APIRouter(prefix="/investments", tags=["investments"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _build_investment_response(acc: Account, db: AsyncSession) -> dict:
    """Calculate total contributed from Transfer Out transactions pointing to this account."""
    result = await db.execute(
        select(func.coalesce(func.sum(Transaction.tx_amount), 0)).where(
            Transaction.transfer_account_id == acc.id,
            Transaction.tx_type == "Expense",
        )
    )
    total_contributed = float(result.scalar())

    current_value = acc.current_value
    if current_value is not None:
        return_amount = current_value - total_contributed
        return_pct = (return_amount / total_contributed * 100) if total_contributed > 0 else None
    else:
        return_amount = None
        return_pct = None

    return {
        "id": acc.id,
        "account_name": acc.account_name,
        "bank_name": acc.bank_name,
        "account_number": acc.account_number,
        "total_contributed": total_contributed,
        "current_value": current_value,
        "current_value_at": acc.current_value_at,
        "return_amount": return_amount,
        "return_pct": return_pct,
    }


def _compute_arr(cost_basis: float, current_value: float, first_buy_date: date) -> tuple[float | None, bool]:
    """
    Compute annualised compound return (ARR) and flag if hold < 1 year.
    Returns (arr_as_fraction, arr_short_hold).
    """
    if cost_basis <= 0 or current_value is None:
        return None, False
    today = date.today()
    years = (today - first_buy_date).days / 365.25
    if years <= 0:
        return None, True
    arr = (current_value / cost_basis) ** (1.0 / years) - 1.0
    return arr, years < 1


async def _get_latest_prices(account_id: int, db: AsyncSession) -> dict[str, float]:
    """Return {security_code: latest_price} from stock_valuations."""
    # Subquery: latest valuation per security for this account
    subq = (
        select(
            StockValuation.security_code,
            func.max(StockValuation.valuation_date).label("latest_date"),
        )
        .where(StockValuation.account_id == account_id)
        .group_by(StockValuation.security_code)
        .subquery()
    )
    result = await db.execute(
        select(StockValuation.security_code, StockValuation.price)
        .join(
            subq,
            (StockValuation.security_code == subq.c.security_code)
            & (StockValuation.valuation_date == subq.c.latest_date),
        )
        .where(StockValuation.account_id == account_id)
    )
    return {row[0]: float(row[1]) for row in result.all()}


# ── Account-level endpoints ────────────────────────────────────────────────────

@router.get("", response_model=list[InvestmentResponse])
async def list_investments(db: AsyncSession = Depends(get_db)):
    """List all investment accounts with contribution totals and return calculations."""
    result = await db.execute(
        select(Account)
        .where(Account.account_type == "investment", Account.is_active == True)
        .order_by(Account.account_name)
    )
    accounts = result.scalars().all()
    return [await _build_investment_response(acc, db) for acc in accounts]


@router.patch("/{account_id}/value", response_model=InvestmentResponse)
async def update_current_value(
    account_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Update the current portfolio value for an investment account.
    Body: { "current_value": 5100.00 }
    """
    result = await db.execute(
        select(Account).where(Account.id == account_id, Account.account_type == "investment")
    )
    acc = result.scalar_one_or_none()
    if not acc:
        raise HTTPException(status_code=404, detail="Investment account not found")

    value = body.get("current_value")
    if value is None or not isinstance(value, (int, float)):
        raise HTTPException(status_code=422, detail="current_value must be a number")

    acc.current_value = float(value)
    acc.current_value_at = datetime.utcnow()
    await db.commit()
    await db.refresh(acc)
    return await _build_investment_response(acc, db)


# ── Stock trade endpoints ──────────────────────────────────────────────────────

@router.get("/{account_id}/trades", response_model=list[StockTradeResponse])
async def list_trades(
    account_id: int,
    security_code: str | None = Query(default=None),
    trade_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """List raw stock trades for an investment account, with optional filters."""
    # Verify account exists
    acc = await db.execute(select(Account).where(Account.id == account_id))
    if not acc.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Account not found")

    q = select(StockTrade).where(StockTrade.account_id == account_id)
    if security_code:
        q = q.where(StockTrade.security_code == security_code.upper())
    if trade_type:
        q = q.where(StockTrade.trade_type == trade_type)

    q = q.order_by(desc(StockTrade.trade_date), desc(StockTrade.id))
    q = q.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/{account_id}/holdings", response_model=list[HoldingRow])
async def get_holdings(
    account_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Return aggregated holdings for an investment account.

    For each security:
    - quantity_held = SUM(qty for Buy) - SUM(qty for Sell)
    - cost_basis    = SUM(ABS(net_amount)) for Buy trades
    - dividends     = SUM(net_amount) for Dividend Received
    - current_value derived from latest StockValuation price
    - P&L, total return, ARR computed in Python
    """
    # Verify account exists
    acc_result = await db.execute(select(Account).where(Account.id == account_id))
    if not acc_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Account not found")

    # Aggregate trades by security
    agg = await db.execute(
        select(
            StockTrade.security_code,
            func.max(StockTrade.security_name).label("security_name"),
            func.sum(
                case(
                    (StockTrade.trade_type == "Buy", func.coalesce(StockTrade.quantity, 0)),
                    (StockTrade.trade_type == "Sell", -func.coalesce(StockTrade.quantity, 0)),
                    else_=0,
                )
            ).label("quantity_held"),
            func.sum(
                case(
                    (StockTrade.trade_type.in_(["Buy", "Sell"]), func.abs(StockTrade.net_amount)),
                    else_=0,
                )
            ).label("cost_basis"),
            func.sum(
                case(
                    (StockTrade.trade_type == "Dividend Received", StockTrade.net_amount),
                    else_=0,
                )
            ).label("total_dividends"),
            func.sum(StockTrade.brokerage).label("brokerage_total"),
            func.min(
                case(
                    (StockTrade.trade_type == "Buy", StockTrade.trade_date),
                    else_=None,
                )
            ).label("first_buy_date"),
        )
        .where(StockTrade.account_id == account_id)
        .group_by(StockTrade.security_code)
        .order_by(StockTrade.security_code)
    )
    rows = agg.all()

    prices = await _get_latest_prices(account_id, db)
    holdings: list[HoldingRow] = []

    for row in rows:
        qty = float(row.quantity_held or 0)
        cost = float(row.cost_basis or 0)
        divs = float(row.total_dividends or 0)
        brok = float(row.brokerage_total or 0)
        first_buy = row.first_buy_date.date() if row.first_buy_date else None

        avg_cost = (cost / qty) if qty > 0 else None
        current_price = prices.get(row.security_code)
        current_value = (current_price * qty) if current_price is not None else None
        unrealised_gain = (current_value - cost) if current_value is not None else None
        unrealised_gain_pct = (
            (unrealised_gain / cost * 100) if (unrealised_gain is not None and cost > 0) else None
        )
        total_gain = (
            (unrealised_gain + divs) if unrealised_gain is not None else None
        )
        total_return_pct = (
            (total_gain / cost * 100) if (total_gain is not None and cost > 0) else None
        )
        arr, arr_short = _compute_arr(cost, current_value, first_buy) if (current_value and first_buy) else (None, False)

        holdings.append(HoldingRow(
            security_code=row.security_code,
            security_name=row.security_name or "",
            quantity_held=qty,
            avg_cost_per_unit=avg_cost,
            cost_basis=cost,
            current_price=current_price,
            current_value=current_value,
            unrealised_gain=unrealised_gain,
            unrealised_gain_pct=unrealised_gain_pct,
            total_dividends=divs,
            total_gain=total_gain,
            total_return_pct=total_return_pct,
            arr=arr,
            arr_short_hold=arr_short,
            first_buy_date=first_buy,
            brokerage_total=brok,
        ))

    return holdings


@router.get("/{account_id}/dividends", response_model=list[DividendRow])
async def get_dividends(
    account_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Monthly dividend totals per security — for the dividend timeline chart."""
    acc_result = await db.execute(select(Account).where(Account.id == account_id))
    if not acc_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Account not found")

    result = await db.execute(
        select(
            func.date_format(StockTrade.trade_date, "%Y-%m").label("month"),
            StockTrade.security_code,
            func.max(StockTrade.security_name).label("security_name"),
            func.sum(StockTrade.net_amount).label("amount"),
        )
        .where(
            StockTrade.account_id == account_id,
            StockTrade.trade_type == "Dividend Received",
        )
        .group_by(text("month"), StockTrade.security_code)
        .order_by(text("month"), StockTrade.security_code)
    )
    return [
        DividendRow(
            month=row.month,
            security_code=row.security_code,
            security_name=row.security_name or "",
            amount=float(row.amount or 0),
        )
        for row in result.all()
    ]


@router.get("/{account_id}/performance", response_model=list[PerformanceRow])
async def get_performance(
    account_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Monthly cumulative cost basis.

    portfolio_value is None until prices are entered for all holdings.
    Used for the portfolio growth line chart.
    """
    acc_result = await db.execute(select(Account).where(Account.id == account_id))
    if not acc_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Account not found")

    # Monthly cumulative Buy amounts
    result = await db.execute(
        select(
            func.date_format(StockTrade.trade_date, "%Y-%m").label("month"),
            func.sum(func.abs(StockTrade.net_amount)).label("monthly_cost"),
        )
        .where(
            StockTrade.account_id == account_id,
            StockTrade.trade_type == "Buy",
        )
        .group_by(text("month"))
        .order_by(text("month"))
    )
    rows = result.all()
    if not rows:
        return []

    cumulative = 0.0
    perf: list[PerformanceRow] = []
    for row in rows:
        cumulative += float(row.monthly_cost or 0)
        perf.append(PerformanceRow(month=row.month, cost_basis=round(cumulative, 2), portfolio_value=None))

    return perf


@router.patch("/holdings/{account_id}/{security_code}/price", response_model=HoldingRow)
async def update_holding_price(
    account_id: int,
    security_code: str,
    body: HoldingPriceUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Set the current unit price for a security in a brokerage account.
    Creates a new StockValuation row; the most recent is always used.
    Returns the updated HoldingRow.
    """
    acc_result = await db.execute(select(Account).where(Account.id == account_id))
    if not acc_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Account not found")

    # Verify security exists in this account
    trade_result = await db.execute(
        select(StockTrade).where(
            StockTrade.account_id == account_id,
            StockTrade.security_code == security_code.upper(),
        )
    )
    if not trade_result.scalars().first():
        raise HTTPException(status_code=404, detail=f"Security {security_code} not found in this account")

    valuation = StockValuation(
        account_id=account_id,
        security_code=security_code.upper(),
        price=body.price,
        valuation_date=datetime.utcnow(),
    )
    db.add(valuation)
    await db.commit()

    # Return updated holdings for this security
    holdings = await get_holdings(account_id=account_id, db=db)
    match = next((h for h in holdings if h.security_code == security_code.upper()), None)
    if not match:
        raise HTTPException(status_code=404, detail="Holding not found after update")
    return match
