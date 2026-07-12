"""
Lending endpoints — loans the user has given out.

Routes:
  GET  /lending/summary          — portfolio totals
  GET  /lending                  — list all loans with computed fields
  POST /lending                  — create a loan
  GET  /lending/{id}             — single loan
  PUT  /lending/{id}             — update a loan
  DELETE /lending/{id}           — delete a loan (unlinks transactions via SET NULL)
  GET  /lending/{id}/schedule    — amortisation table (404 for open-ended loans)
  GET  /lending/{id}/transactions — bank transactions linked to this loan
"""

from datetime import datetime

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Asset, LendingLoan, Transaction
from app.schemas import (
    AmortisationRow,
    AssetResponse,
    LendingLoanCreate,
    LendingLoanResponse,
    LendingLoanUpdate,
    LendingPortfolioSummary,
)

router = APIRouter(prefix="/lending", tags=["lending"])


def _compute_monthly_payment(principal: float, annual_rate_pct: float, term_months: int, repayment_type: str) -> float:
    r = annual_rate_pct / 100 / 12
    if repayment_type == "interest_only":
        return round(principal * r, 2)
    if r == 0:
        return round(principal / term_months, 2)
    return round(principal * r / (1 - (1 + r) ** -term_months), 2)


def _compute_total_interest(principal: float, annual_rate_pct: float, term_months: int, repayment_type: str) -> float:
    monthly = _compute_monthly_payment(principal, annual_rate_pct, term_months, repayment_type)
    if repayment_type == "interest_only":
        return round(monthly * term_months, 2)
    return round(monthly * term_months - principal, 2)


def _build_schedule(loan: LendingLoan) -> list[AmortisationRow]:
    r = loan.interest_rate / 100 / 12
    monthly = _compute_monthly_payment(loan.principal, loan.interest_rate, loan.term_months, loan.repayment_type)
    balance = loan.principal
    rows = []
    for i in range(1, loan.term_months + 1):
        interest = round(balance * r, 2)
        if loan.repayment_type == "interest_only":
            principal_portion = 0.0
            closing = balance
        else:
            principal_portion = round(monthly - interest, 2)
            closing = round(max(0.0, balance - principal_portion), 2)
        payment_date = (loan.start_date + relativedelta(months=i)).strftime("%Y-%m-%d")
        rows.append(AmortisationRow(
            period=i,
            payment_date=payment_date,
            opening_balance=round(balance, 2),
            payment_amount=monthly,
            interest=interest,
            principal=principal_portion,
            closing_balance=closing,
        ))
        balance = closing
    return rows


async def _get_loan_or_404(loan_id: int, db: AsyncSession) -> LendingLoan:
    result = await db.execute(
        select(LendingLoan)
        .options(selectinload(LendingLoan.asset))
        .where(LendingLoan.id == loan_id)
    )
    loan = result.scalar_one_or_none()
    if not loan:
        raise HTTPException(status_code=404, detail="Lending loan not found")
    return loan


async def _build_response(loan: LendingLoan, db: AsyncSession) -> LendingLoanResponse:
    repaid_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.tx_amount), 0.0))
        .where(Transaction.lending_loan_id == loan.id)
        .where(Transaction.lending_tx_type == "repayment")
    )
    disbursed_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.tx_amount), 0.0))
        .where(Transaction.lending_loan_id == loan.id)
        .where(Transaction.lending_tx_type == "disbursement")
    )
    total_repaid = float(repaid_result.scalar() or 0.0)
    disbursed_amount = float(disbursed_result.scalar() or 0.0)

    monthly_payment = None
    total_interest = None
    if loan.term_months:
        monthly_payment = _compute_monthly_payment(loan.principal, loan.interest_rate, loan.term_months, loan.repayment_type)
        total_interest = _compute_total_interest(loan.principal, loan.interest_rate, loan.term_months, loan.repayment_type)

    asset_response = None
    if loan.asset:
        asset_response = AssetResponse.model_validate(loan.asset)

    return LendingLoanResponse(
        id=loan.id,
        loan_name=loan.loan_name,
        loan_type=loan.loan_type,
        borrower_name=loan.borrower_name,
        principal=loan.principal,
        interest_rate=loan.interest_rate,
        start_date=loan.start_date,
        term_months=loan.term_months,
        repayment_type=loan.repayment_type,
        status=loan.status,
        notes=loan.notes,
        asset_id=loan.asset_id,
        ownership_pct=loan.ownership_pct,
        first_payment_date=loan.first_payment_date,
        manual_disbursement_date=loan.manual_disbursement_date,
        manual_disbursement_amount=loan.manual_disbursement_amount,
        created_at=loan.created_at,
        monthly_payment=monthly_payment,
        total_interest=total_interest,
        total_repaid=round(total_repaid, 2),
        disbursed_amount=round(disbursed_amount, 2),
        asset=asset_response,
    )


@router.get("/summary", response_model=LendingPortfolioSummary)
async def get_portfolio_summary(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LendingLoan))
    all_loans = result.scalars().all()

    count_active = sum(1 for l in all_loans if l.status == "active")
    count_paid_off = sum(1 for l in all_loans if l.status == "paid_off")
    count_defaulted = sum(1 for l in all_loans if l.status == "defaulted")

    active_loans = [l for l in all_loans if l.status == "active"]
    total_capital = sum(l.principal for l in active_loans)
    total_monthly = sum(
        _compute_monthly_payment(l.principal, l.interest_rate, l.term_months, l.repayment_type)
        for l in active_loans if l.term_months
    )
    weighted_rate = (
        sum(l.principal * l.interest_rate for l in active_loans) / total_capital
        if total_capital > 0 else None
    )

    return LendingPortfolioSummary(
        total_capital_deployed=round(total_capital, 2),
        total_monthly_income=round(total_monthly, 2),
        weighted_avg_rate=round(weighted_rate, 4) if weighted_rate else None,
        count_active=count_active,
        count_paid_off=count_paid_off,
        count_defaulted=count_defaulted,
    )


@router.get("", response_model=list[LendingLoanResponse])
async def list_loans(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(LendingLoan)
        .options(selectinload(LendingLoan.asset))
        .order_by(LendingLoan.status, LendingLoan.start_date.desc())
    )
    loans = result.scalars().all()
    return [await _build_response(loan, db) for loan in loans]


@router.post("", response_model=LendingLoanResponse, status_code=201)
async def create_loan(payload: LendingLoanCreate, db: AsyncSession = Depends(get_db)):
    if payload.asset_id:
        asset_exists = await db.execute(select(Asset).where(Asset.id == payload.asset_id))
        if not asset_exists.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Asset not found")

    loan = LendingLoan(**payload.model_dump())
    db.add(loan)
    await db.commit()
    await db.refresh(loan)
    result = await db.execute(
        select(LendingLoan).options(selectinload(LendingLoan.asset)).where(LendingLoan.id == loan.id)
    )
    loan = result.scalar_one()
    return await _build_response(loan, db)


@router.get("/{loan_id}", response_model=LendingLoanResponse)
async def get_loan(loan_id: int, db: AsyncSession = Depends(get_db)):
    loan = await _get_loan_or_404(loan_id, db)
    return await _build_response(loan, db)


@router.put("/{loan_id}", response_model=LendingLoanResponse)
async def update_loan(loan_id: int, payload: LendingLoanUpdate, db: AsyncSession = Depends(get_db)):
    loan = await _get_loan_or_404(loan_id, db)
    update_data = payload.model_dump(exclude_unset=True)
    if "asset_id" in update_data and update_data["asset_id"]:
        asset_exists = await db.execute(select(Asset).where(Asset.id == update_data["asset_id"]))
        if not asset_exists.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Asset not found")
    for field, value in update_data.items():
        setattr(loan, field, value)
    await db.commit()
    result = await db.execute(
        select(LendingLoan).options(selectinload(LendingLoan.asset)).where(LendingLoan.id == loan_id)
    )
    loan = result.scalar_one()
    return await _build_response(loan, db)


@router.delete("/{loan_id}", status_code=204)
async def delete_loan(loan_id: int, db: AsyncSession = Depends(get_db)):
    loan = await _get_loan_or_404(loan_id, db)
    await db.delete(loan)
    await db.commit()


@router.get("/{loan_id}/schedule", response_model=list[AmortisationRow])
async def get_schedule(loan_id: int, db: AsyncSession = Depends(get_db)):
    loan = await _get_loan_or_404(loan_id, db)
    if not loan.term_months:
        raise HTTPException(status_code=404, detail="No schedule for open-ended loans")

    rows = _build_schedule(loan)

    tx_result = await db.execute(
        select(Transaction)
        .where(Transaction.lending_loan_id == loan_id)
        .where(Transaction.lending_tx_type == "repayment")
    )
    repayment_txs = tx_result.scalars().all()

    for row in rows:
        payment_dt = datetime.strptime(row.payment_date, "%Y-%m-%d")
        for tx in repayment_txs:
            tx_dt = tx.tx_date if isinstance(tx.tx_date, datetime) else datetime.combine(tx.tx_date, datetime.min.time())
            if abs((tx_dt - payment_dt).days) <= 5:
                row.actual_payment = tx.tx_amount
                row.actual_tx_id = tx.id
                break

    return rows


@router.get("/{loan_id}/transactions", response_model=list[dict])
async def get_loan_transactions(loan_id: int, db: AsyncSession = Depends(get_db)):
    await _get_loan_or_404(loan_id, db)
    result = await db.execute(
        select(Transaction)
        .where(Transaction.lending_loan_id == loan_id)
        .order_by(Transaction.tx_date.desc())
    )
    txs = result.scalars().all()
    return [
        {
            "id": tx.id,
            "tx_date": tx.tx_date.isoformat() if tx.tx_date else None,
            "tx_desc": tx.tx_desc,
            "tx_amount": tx.tx_amount,
            "tx_type": tx.tx_type,
            "lending_tx_type": tx.lending_tx_type,
            "account_id": tx.account_id,
        }
        for tx in txs
    ]
