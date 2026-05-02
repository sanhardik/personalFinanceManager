"""
Loan endpoints for Personal Finance Manager.

Routes:
  GET /loans                  — All home_loan accounts with key metrics
  GET /loans/{id}/summary     — Full summary for one loan
  GET /loans/{id}/history     — Monthly payment breakdown (interest, principal, balance)

Projected payoff logic:
  - Only for principal_and_interest loans with a known interest rate
  - Uses average payment from last 3 months and remaining balance
  - Interest-only loans show loan_repayment_type="interest_only" with no payoff date
"""

import math
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Account, Asset, Category, Transaction
from app.utils.db_compat import month_col
from app.schemas import AssetResponse, LoanHistoryRow, LoanSummaryResponse
from app.services.auth import get_current_user

router = APIRouter(prefix="/loans", tags=["loans"], dependencies=[Depends(get_current_user)])

# Categories used to identify interest and payment transactions on a loan account
INTEREST_CATEGORY = "Home Loan Interest"
PAYMENT_CATEGORY = "Home Loan Payment"


async def _get_loan_or_404(account_id: int, db: AsyncSession) -> Account:
    result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.account_type == "home_loan",
        )
    )
    loan = result.scalar_one_or_none()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan account not found")
    return loan


def _projected_payoff(
    balance: float,
    annual_rate_pct: float,
    avg_monthly_payment: float,
) -> str | None:
    """
    Calculate projected payoff date using standard amortisation formula.

    Returns ISO date string (YYYY-MM-DD) or None if inputs are invalid
    (e.g. payment ≤ interest → loan will never be paid off).
    """
    if balance <= 0 or annual_rate_pct <= 0 or avg_monthly_payment <= 0:
        return None

    monthly_rate = annual_rate_pct / 100 / 12
    monthly_interest = balance * monthly_rate

    if avg_monthly_payment <= monthly_interest:
        # Payment doesn't cover interest — will never pay off
        return None

    try:
        months = -math.log(1 - (balance * monthly_rate / avg_monthly_payment)) / math.log(1 + monthly_rate)
        if months <= 0 or months > 1200:  # Sanity check: max 100 years
            return None
        payoff_date = datetime.today() + timedelta(days=months * 30.44)
        return payoff_date.strftime("%Y-%m-%d")
    except (ValueError, ZeroDivisionError):
        return None


async def _loan_summary(loan: Account, db: AsyncSession) -> LoanSummaryResponse:
    """Build a LoanSummaryResponse for a single loan account."""

    # Current balance = abs of latest transaction balance (loans have negative balance).
    # Macquarie CSVs list payment (Credit/Income) before interest on the same date — the
    # payment reflects the final balance for that day. We pick Income transactions first
    # (tx_type ASC → "Income" < "Expense") as tiebreaker so the payment row wins.
    latest_balance_result = await db.execute(
        select(Transaction.balance)
        .where(Transaction.account_id == loan.id)
        .where(Transaction.balance.isnot(None))
        .order_by(Transaction.tx_date.desc(), Transaction.tx_type.desc(), Transaction.id.asc())
        .limit(1)
    )
    latest_balance_raw = latest_balance_result.scalar_one_or_none()
    current_balance = abs(latest_balance_raw) if latest_balance_raw is not None else None

    # Total interest paid = sum of all Expense transactions matching "Home Loan Interest"
    interest_cat = await db.execute(
        select(Category.id).where(Category.name == INTEREST_CATEGORY)
    )
    interest_cat_id = interest_cat.scalar_one_or_none()

    total_interest = 0.0
    if interest_cat_id:
        result = await db.execute(
            select(func.coalesce(func.sum(Transaction.tx_amount), 0.0))
            .where(Transaction.account_id == loan.id)
            .where(Transaction.category_id == interest_cat_id)
        )
        total_interest = float(result.scalar() or 0.0)

    # Original amount: from account field, or derive from "Loan drawdown" transaction
    original_amount = loan.loan_original_amount
    if original_amount is None:
        drawdown_result = await db.execute(
            select(func.sum(Transaction.tx_amount))
            .where(Transaction.account_id == loan.id)
            .where(Transaction.tx_desc.ilike("%drawdown%"))
        )
        drawdown_total = drawdown_result.scalar_one_or_none()
        if drawdown_total:
            original_amount = float(drawdown_total)

    # Principal paid = original - current_balance
    total_principal = 0.0
    percent_paid = None
    if original_amount and current_balance is not None:
        total_principal = max(0.0, original_amount - current_balance)
        percent_paid = round(total_principal / original_amount * 100, 2) if original_amount > 0 else 0.0

    # Average monthly repayment — sum Income transactions per calendar month, then
    # average the last 3 *complete* months (exclude the current partial month).
    # Using recent complete months avoids skew from old lump-sum or extra payments.
    first_of_this_month = datetime.today().replace(day=1).date()
    month_expr = month_col(Transaction.tx_date)
    recent_monthly = await db.execute(
        select(
            month_expr.label("month"),
            func.sum(Transaction.tx_amount).label("total"),
        )
        .where(Transaction.account_id == loan.id)
        .where(Transaction.tx_type == "Income")
        .where(Transaction.tx_date < first_of_this_month)
        .group_by(month_expr)
        .order_by(month_expr.desc())
        .limit(3)
    )
    monthly_payment_totals = [float(r.total) for r in recent_monthly.all()]
    avg_monthly_payment = (
        sum(monthly_payment_totals) / len(monthly_payment_totals)
        if monthly_payment_totals else None
    )

    # Projected payoff date
    projected_payoff = None
    repayment_type = loan.loan_repayment_type
    if (
        repayment_type != "interest_only"
        and current_balance
        and loan.loan_interest_rate
        and avg_monthly_payment
    ):
        projected_payoff = _projected_payoff(
            balance=current_balance,
            annual_rate_pct=loan.loan_interest_rate,
            avg_monthly_payment=avg_monthly_payment,
        )

    # Asset details
    asset_response = None
    if loan.asset_id:
        asset_result = await db.execute(
            select(Asset).where(Asset.id == loan.asset_id)
        )
        asset = asset_result.scalar_one_or_none()
        if asset:
            asset_response = AssetResponse.model_validate(asset)

    return LoanSummaryResponse(
        account_id=loan.id,
        account_name=loan.account_name,
        account_number=loan.account_number,
        bank_name=loan.bank_name,
        loan_repayment_type=repayment_type,
        loan_interest_rate=loan.loan_interest_rate,
        loan_term_years=loan.loan_term_years,
        loan_start_date=loan.loan_start_date,
        loan_original_amount=original_amount,
        current_balance=current_balance,
        total_interest_paid=round(total_interest, 2),
        total_principal_paid=round(total_principal, 2),
        percent_paid=percent_paid,
        avg_monthly_payment=round(avg_monthly_payment, 2) if avg_monthly_payment else None,
        projected_payoff_date=projected_payoff,
        asset_id=loan.asset_id,
        asset=asset_response,
    )


@router.get("", response_model=list[LoanSummaryResponse])
async def list_loans(db: AsyncSession = Depends(get_db)):
    """Return all home_loan accounts with their summary metrics."""
    result = await db.execute(
        select(Account)
        .where(Account.account_type == "home_loan")
        .order_by(Account.account_name)
    )
    loans = result.scalars().all()
    return [await _loan_summary(loan, db) for loan in loans]


@router.get("/{account_id}/summary", response_model=LoanSummaryResponse)
async def get_loan_summary(account_id: int, db: AsyncSession = Depends(get_db)):
    """Full summary for a single loan account."""
    loan = await _get_loan_or_404(account_id, db)
    return await _loan_summary(loan, db)


@router.get("/{account_id}/history", response_model=list[LoanHistoryRow])
async def get_loan_history(account_id: int, db: AsyncSession = Depends(get_db)):
    """
    Monthly payment history for a loan — interest, principal, payment, balance.

    Groups transactions by month (YYYY-MM).
    Interest = sum of Expense transactions in that month (interest charged).
    Payment = sum of Income transactions in that month (repayments received).
    Principal = payment - interest.
    Balance = last transaction balance in that month.
    """
    await _get_loan_or_404(account_id, db)

    # Fetch all transactions for this loan, oldest first
    tx_result = await db.execute(
        select(Transaction)
        .where(Transaction.account_id == account_id)
        .order_by(Transaction.tx_date.asc(), Transaction.id.asc())
    )
    transactions = tx_result.scalars().all()

    # Group by month
    monthly: dict[str, dict] = {}
    for tx in transactions:
        month_key = tx.tx_date.strftime("%Y-%m")
        if month_key not in monthly:
            monthly[month_key] = {"payment": 0.0, "interest": 0.0, "balance": None}

        if tx.tx_type == "Income":
            monthly[month_key]["payment"] += tx.tx_amount
        else:
            monthly[month_key]["interest"] += tx.tx_amount

        if tx.balance is not None:
            monthly[month_key]["balance"] = tx.balance

    # Skip the first month if it only contains the drawdown (no interest yet)
    history = []
    for month, data in sorted(monthly.items()):
        payment = round(data["payment"], 2)
        interest = round(data["interest"], 2)
        # Skip pure drawdown months (large debit, no interest, no payment)
        if interest == 0.0 and payment == 0.0:
            continue
        history.append(
            LoanHistoryRow(
                month=month,
                payment=payment,
                interest=interest,
                principal=round(payment - interest, 2),
                balance=data["balance"],
            )
        )

    return history
