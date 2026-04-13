"""
Investment account endpoints.

Routes:
  GET   /investments          — list investment accounts with contribution + return summary
  PATCH /investments/{id}/value — update current portfolio value (and timestamp)
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Account, Transaction
from app.schemas import InvestmentResponse

router = APIRouter(prefix="/investments", tags=["investments"])


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
