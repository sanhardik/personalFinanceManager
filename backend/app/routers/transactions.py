"""
Transaction endpoints for Personal Finance Manager.

Routes:
  GET /transactions — List transactions with filters + pagination
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Transaction
from app.schemas import TransactionResponse

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("")
async def list_transactions(
    account_id: int | None = Query(default=None, description="Filter by account"),
    tx_type: str | None = Query(default=None, pattern="^(Income|Expense)$"),
    search: str | None = Query(default=None, description="Search in description"),
    categorised: bool | None = Query(default=None, description="Filter by categorised status"),
    page: int = Query(default=1, ge=1, description="Page number"),
    per_page: int = Query(default=50, ge=1, le=200, description="Items per page"),
    db: AsyncSession = Depends(get_db),
):
    """
    List transactions with optional filters and pagination.

    Returns paginated results with total count for frontend pagination.
    """
    # Base query
    stmt = select(Transaction)
    count_stmt = select(func.count(Transaction.id))

    # Apply filters
    if account_id:
        stmt = stmt.where(Transaction.account_id == account_id)
        count_stmt = count_stmt.where(Transaction.account_id == account_id)
    if tx_type:
        stmt = stmt.where(Transaction.tx_type == tx_type)
        count_stmt = count_stmt.where(Transaction.tx_type == tx_type)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(Transaction.tx_desc.ilike(pattern))
        count_stmt = count_stmt.where(Transaction.tx_desc.ilike(pattern))
    if categorised is not None:
        stmt = stmt.where(Transaction.is_categorised == categorised)
        count_stmt = count_stmt.where(Transaction.is_categorised == categorised)

    # Get total count
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Apply pagination and ordering
    offset = (page - 1) * per_page
    stmt = stmt.order_by(desc(Transaction.tx_date), desc(Transaction.id))
    stmt = stmt.offset(offset).limit(per_page)

    result = await db.execute(stmt)
    transactions = result.scalars().all()

    return {
        "items": [TransactionResponse.model_validate(tx) for tx in transactions],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if total > 0 else 0,
    }
