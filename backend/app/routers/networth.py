"""
Net Worth Journey endpoint.

Routes:
  GET /networth/journey — monthly timeline of cash, investments, properties, loans, net_worth
                          plus auto-detected milestone markers
"""
from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Account, Asset, StockTrade, Transaction
from app.schemas import NetWorthJourneyResponse, NetWorthMilestone, NetWorthPoint
from app.services.auth import get_current_user

router = APIRouter(prefix="/networth", tags=["networth"], dependencies=[Depends(get_current_user)])


def _month_range(start: date, end: date) -> list[str]:
    """Generate YYYY-MM strings from start month to end month inclusive."""
    months = []
    cur = start.replace(day=1)
    end_month = end.replace(day=1)
    while cur <= end_month:
        months.append(cur.strftime("%Y-%m"))
        if cur.month == 12:
            cur = cur.replace(year=cur.year + 1, month=1)
        else:
            cur = cur.replace(month=cur.month + 1)
    return months


def _month_end(month_str: str) -> date:
    """Return the last day of the given YYYY-MM month."""
    year, month = map(int, month_str.split("-"))
    if month == 12:
        return date(year, 12, 31)
    return date(year, month + 1, 1) - timedelta(days=1)


def _to_date(d) -> date:
    """Convert datetime or date to date."""
    return d.date() if hasattr(d, "date") else d


def _last_balance_at(history: list[tuple[date, float]], month_end_date: date) -> float | None:
    """
    Given a sorted list of (date, balance) pairs, return the last balance
    on or before month_end_date. Returns None if no data yet.
    """
    last = None
    for d, bal in history:
        if d <= month_end_date:
            last = bal
        else:
            break
    return float(last) if last is not None else None


@router.get("/journey", response_model=NetWorthJourneyResponse)
async def get_journey(db: AsyncSession = Depends(get_db)):
    """
    Monthly net worth timeline from first transaction/trade/asset to today.
    Returns timeline + auto-detected milestones.
    """
    today = date.today()

    # ── 1. Bank/credit_card balances ──────────────────────────
    bank_acc_result = await db.execute(
        select(Account.id).where(
            Account.account_type.in_(["bank", "credit_card"]),
            Account.is_active == True,
        )
    )
    bank_ids = [r[0] for r in bank_acc_result.all()]

    bank_balance_history: dict[int, list[tuple[date, float]]] = defaultdict(list)
    if bank_ids:
        bank_tx_result = await db.execute(
            select(Transaction.account_id, Transaction.tx_date, Transaction.balance)
            .where(
                Transaction.account_id.in_(bank_ids),
                Transaction.balance.isnot(None),
            )
            .order_by(Transaction.account_id, Transaction.tx_date, Transaction.id)
        )
        for acc_id, tx_date, balance in bank_tx_result.all():
            bank_balance_history[acc_id].append((_to_date(tx_date), float(balance)))

    # ── 2. Loan balances ──────────────────────────────────────
    loan_acc_result = await db.execute(
        select(Account.id).where(Account.account_type == "home_loan")
    )
    loan_ids = [r[0] for r in loan_acc_result.all()]

    loan_balance_history: dict[int, list[tuple[date, float]]] = defaultdict(list)
    if loan_ids:
        loan_tx_result = await db.execute(
            select(Transaction.account_id, Transaction.tx_date, Transaction.balance)
            .where(
                Transaction.account_id.in_(loan_ids),
                Transaction.balance.isnot(None),
            )
            .order_by(Transaction.account_id, Transaction.tx_date, Transaction.id)
        )
        for acc_id, tx_date, balance in loan_tx_result.all():
            loan_balance_history[acc_id].append((_to_date(tx_date), float(balance)))

    # ── 3. Stock trades ────────────────────────────────────────
    stock_result = await db.execute(
        select(StockTrade.trade_date, StockTrade.trade_type, StockTrade.net_amount)
        .order_by(StockTrade.trade_date)
    )
    stock_trades = [(row[0], row[1], row[2]) for row in stock_result.all()]

    # Monthly Buy cost (for cumulative cost basis)
    stock_monthly_cost: dict[str, float] = defaultdict(float)
    first_buy_date: date | None = None
    for trade_date, trade_type, net_amount in stock_trades:
        d = _to_date(trade_date)
        if trade_type == "Buy":
            stock_monthly_cost[d.strftime("%Y-%m")] += abs(float(net_amount))
            if first_buy_date is None or d < first_buy_date:
                first_buy_date = d

    # ── 4. Properties ─────────────────────────────────────────
    prop_result = await db.execute(
        select(Asset.asset_name, Asset.purchase_date, Asset.current_value)
        .where(Asset.asset_type == "property")
    )
    properties = [(row[0], row[1], row[2]) for row in prop_result.all()]

    # ── 5. Determine timeline start ────────────────────────────
    all_dates: list[date] = []
    for history in bank_balance_history.values():
        if history:
            all_dates.append(history[0][0])
    for history in loan_balance_history.values():
        if history:
            all_dates.append(history[0][0])
    if first_buy_date:
        all_dates.append(first_buy_date)
    for _, purchase_date, current_value in properties:
        if purchase_date and current_value:
            all_dates.append(_to_date(purchase_date))

    if not all_dates:
        return NetWorthJourneyResponse(timeline=[], milestones=[])

    start_date = min(all_dates)
    months = _month_range(start_date, today)

    # ── 6. Build timeline ──────────────────────────────────────
    timeline: list[NetWorthPoint] = []
    cumulative_investments = 0.0

    for month in months:
        me = _month_end(month)

        # Cash
        cash = 0.0
        for acc_id, history in bank_balance_history.items():
            b = _last_balance_at(history, me)
            if b is not None:
                cash += b

        # Loans
        loans = 0.0
        for acc_id, history in loan_balance_history.items():
            b = _last_balance_at(history, me)
            if b is not None:
                loans += abs(b)

        # Investments (cumulative cost basis)
        cumulative_investments += stock_monthly_cost.get(month, 0.0)

        # Properties (use current_value from purchase_date onwards)
        property_value = 0.0
        for asset_name, purchase_date, current_value in properties:
            if purchase_date and current_value:
                pd = _to_date(purchase_date)
                if pd <= me:
                    property_value += float(current_value)

        net_worth = round(cash + cumulative_investments + property_value - loans, 2)
        timeline.append(NetWorthPoint(
            month=month,
            cash=round(cash, 2),
            investments=round(cumulative_investments, 2),
            properties=round(property_value, 2),
            loans=round(loans, 2),
            net_worth=net_worth,
        ))

    # ── 7. Auto-detect milestones ──────────────────────────────
    milestones: list[NetWorthMilestone] = []

    # Journey start
    if timeline:
        milestones.append(NetWorthMilestone(
            month=timeline[0].month,
            type="journey_start",
            label="Journey begins",
        ))

    # Net worth thresholds
    thresholds = [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000]
    hit: set[int] = set()
    for point in timeline:
        for t in thresholds:
            if t not in hit and point.net_worth >= t:
                hit.add(t)
                label = f"Net worth hit ${t:,.0f}" if t < 1_000_000 else "Net worth hit $1M! 🎉"
                milestones.append(NetWorthMilestone(
                    month=point.month,
                    type="net_worth_milestone",
                    label=label,
                    amount=float(t),
                ))

    # Property purchases
    for asset_name, purchase_date, current_value in properties:
        if purchase_date and current_value:
            pd = _to_date(purchase_date)
            milestones.append(NetWorthMilestone(
                month=pd.strftime("%Y-%m"),
                type="property_purchase",
                label=f"Bought {asset_name}",
                amount=float(current_value),
            ))

    # First stock investment
    if first_buy_date:
        milestones.append(NetWorthMilestone(
            month=first_buy_date.strftime("%Y-%m"),
            type="investment_start",
            label="First stock purchase",
        ))

    milestones.sort(key=lambda m: m.month)
    return NetWorthJourneyResponse(timeline=timeline, milestones=milestones)
