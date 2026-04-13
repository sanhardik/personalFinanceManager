"""
Dashboard aggregation endpoints.

Routes:
  GET /dashboard/summary       — totals for the period (income, expenses, savings)
  GET /dashboard/monthly       — month-by-month breakdown
  GET /dashboard/by-category   — spending or income by category
"""
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Category, Transaction

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _transfer_cat_ids():
    """Scalar subquery: IDs of all transfer-type categories."""
    return select(Category.id).where(func.lower(Category.name).like("%transfer%"))


def _base_filters(date_from: date, date_to: date):
    """Common WHERE clauses: date range + exclude transfer categories."""
    return [
        Transaction.tx_date.between(date_from, date_to),
        or_(
            Transaction.category_id.is_(None),
            Transaction.category_id.notin_(_transfer_cat_ids()),
        ),
    ]


@router.get("/summary")
async def get_summary(
    date_from: date = Query(...),
    date_to: date = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Total income, expenses, net savings, and uncategorised count for the period."""
    result = await db.execute(
        select(
            func.coalesce(
                func.sum(case((Transaction.tx_type == "Income", Transaction.tx_amount), else_=0)), 0
            ).label("total_income"),
            func.coalesce(
                func.sum(case((Transaction.tx_type == "Expense", Transaction.tx_amount), else_=0)), 0
            ).label("total_expenses"),
            func.coalesce(
                func.sum(case((Transaction.is_categorised == False, 1), else_=0)), 0
            ).label("uncategorised_count"),
        ).where(*_base_filters(date_from, date_to))
    )
    row = result.one()
    income = float(row.total_income)
    expenses = float(row.total_expenses)
    return {
        "total_income": income,
        "total_expenses": expenses,
        "net_savings": income - expenses,
        "uncategorised_count": int(row.uncategorised_count),
    }


@router.get("/monthly")
async def get_monthly(
    date_from: date = Query(...),
    date_to: date = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Month-by-month income, expenses and savings for the period."""
    month_col = func.date_format(Transaction.tx_date, "%Y-%m")
    result = await db.execute(
        select(
            month_col.label("month"),
            func.coalesce(
                func.sum(case((Transaction.tx_type == "Income", Transaction.tx_amount), else_=0)), 0
            ).label("income"),
            func.coalesce(
                func.sum(case((Transaction.tx_type == "Expense", Transaction.tx_amount), else_=0)), 0
            ).label("expenses"),
        )
        .where(*_base_filters(date_from, date_to))
        .group_by(month_col)
        .order_by(month_col)
    )
    rows = result.all()
    return [
        {
            "month": row.month,
            "income": float(row.income),
            "expenses": float(row.expenses),
            "savings": float(row.income) - float(row.expenses),
        }
        for row in rows
    ]


@router.get("/by-category")
async def get_by_category(
    tx_type: str = Query(..., pattern="^(Income|Expense)$"),
    date_from: date = Query(...),
    date_to: date = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Spending or income broken down by category (transfers excluded)."""
    result = await db.execute(
        select(
            func.coalesce(Category.name, "Uncategorised").label("category_name"),
            func.coalesce(Category.colour, "#94a3b8").label("colour"),
            func.sum(Transaction.tx_amount).label("amount"),
        )
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.tx_date.between(date_from, date_to),
            Transaction.tx_type == tx_type,
            or_(
                Transaction.category_id.is_(None),
                Transaction.category_id.notin_(_transfer_cat_ids()),
            ),
        )
        .group_by(Transaction.category_id, Category.name, Category.colour)
        .order_by(func.sum(Transaction.tx_amount).desc())
    )
    return [
        {
            "category_name": row.category_name,
            "colour": row.colour,
            "amount": float(row.amount or 0),
        }
        for row in result.all()
    ]
