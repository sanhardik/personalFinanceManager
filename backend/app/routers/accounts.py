"""
Account endpoints for Personal Finance Manager.

Routes:
  GET  /accounts         — List all accounts (grouped by bank in response)
  POST /accounts         — Create a new account manually
  GET  /accounts/{id}    — Get a single account
  PUT  /accounts/{id}    — Update an account (name, type, linked account)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Account, StockTrade, StockValuation, Transaction
from app.schemas import AccountCreate, AccountResponse, AccountUpdate

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountResponse])
async def list_accounts(
    db: AsyncSession = Depends(get_db),
):
    """Return all accounts ordered by bank name, then account type."""
    stmt = select(Account).order_by(Account.bank_name, Account.account_type, Account.account_name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=AccountResponse, status_code=201)
async def create_account(
    payload: AccountCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new account manually (e.g. home loan)."""
    # Check for duplicate
    existing = await db.execute(
        select(Account).where(Account.account_number == payload.account_number)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Account '{payload.account_number}' already exists")

    # Validate linked account exists
    if payload.linked_account_id:
        linked = await db.execute(
            select(Account).where(Account.id == payload.linked_account_id)
        )
        if not linked.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Linked account not found")

    # Validate asset exists if provided
    if payload.asset_id:
        from app.models import Asset
        asset = await db.execute(select(Asset).where(Asset.id == payload.asset_id))
        if not asset.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Asset not found")

    account = Account(
        account_number=payload.account_number,
        account_name=payload.account_name,
        bank_name=payload.bank_name,
        account_type=payload.account_type,
        bsb=payload.bsb,
        linked_account_id=payload.linked_account_id,
        asset_id=payload.asset_id,
        loan_original_amount=payload.loan_original_amount,
        loan_interest_rate=payload.loan_interest_rate,
        loan_start_date=payload.loan_start_date,
        loan_term_years=payload.loan_term_years,
        loan_repayment_type=payload.loan_repayment_type,
        offset_account_id=payload.offset_account_id,
        lender_name=payload.lender_name,
        loan_notes=payload.loan_notes,
        payment_frequency=payload.payment_frequency,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


@router.get("/summary")
async def accounts_summary(
    db: AsyncSession = Depends(get_db),
):
    """
    Return accounts grouped by bank with transaction counts and latest balance.
    Used by the Accounts overview page.
    """
    # Get all accounts
    accounts_result = await db.execute(
        select(Account).order_by(Account.bank_name, Account.account_type)
    )
    accounts = accounts_result.scalars().all()

    # Build summary per account
    summary = []
    for acc in accounts:
        # Get transaction count
        count_result = await db.execute(
            select(func.count(Transaction.id)).where(Transaction.account_id == acc.id)
        )
        tx_count = count_result.scalar() or 0

        # Get latest balance (most recent transaction)
        latest_result = await db.execute(
            select(Transaction.balance, Transaction.tx_date)
            .where(Transaction.account_id == acc.id)
            .where(Transaction.balance.isnot(None))
            .order_by(Transaction.tx_date.desc())
            .limit(1)
        )
        latest = latest_result.first()

        summary.append({
            "id": acc.id,
            "account_number": acc.account_number,
            "account_name": acc.account_name,
            "bank_name": acc.bank_name,
            "account_type": acc.account_type,
            "bsb": acc.bsb,
            "is_active": acc.is_active,
            "linked_account_id": acc.linked_account_id,
            "asset_id": acc.asset_id,
            "loan_original_amount": acc.loan_original_amount,
            "loan_interest_rate": acc.loan_interest_rate,
            "loan_start_date": acc.loan_start_date.isoformat() if acc.loan_start_date else None,
            "loan_term_years": acc.loan_term_years,
            "loan_repayment_type": acc.loan_repayment_type,
            "offset_account_id": acc.offset_account_id,
            "transaction_count": tx_count,
            "latest_balance": latest[0] if latest else None,
            "latest_tx_date": latest[1].isoformat() if latest else None,
        })

    return summary


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get a single account by ID."""
    result = await db.execute(
        select(Account).where(Account.id == account_id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.put("/{account_id}", response_model=AccountResponse)
async def update_account(
    account_id: int,
    payload: AccountUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an account (name, type, linked account)."""
    result = await db.execute(
        select(Account).where(Account.id == account_id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    update_data = payload.model_dump(exclude_unset=True)

    # Validate new account_number is not already taken
    if "account_number" in update_data and update_data["account_number"] != account.account_number:
        clash = await db.execute(
            select(Account).where(Account.account_number == update_data["account_number"])
        )
        if clash.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Account number '{update_data['account_number']}' is already in use")

    # Validate linked account if being set
    if "linked_account_id" in update_data and update_data["linked_account_id"]:
        if update_data["linked_account_id"] == account_id:
            raise HTTPException(status_code=400, detail="Account cannot link to itself")
        linked = await db.execute(
            select(Account).where(Account.id == update_data["linked_account_id"])
        )
        if not linked.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Linked account not found")

    for field, value in update_data.items():
        setattr(account, field, value)

    await db.commit()
    await db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=204)
async def delete_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete an account and all associated data (transactions, stock trades, valuations).
    Returns 204 No Content on success.
    """
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Delete child records in FK-safe order
    await db.execute(
        StockValuation.__table__.delete().where(StockValuation.account_id == account_id)
    )
    await db.execute(
        StockTrade.__table__.delete().where(StockTrade.account_id == account_id)
    )
    await db.execute(
        Transaction.__table__.delete().where(Transaction.account_id == account_id)
    )
    await db.delete(account)
    await db.commit()
