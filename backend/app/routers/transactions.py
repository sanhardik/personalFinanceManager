"""
Transaction endpoints for Personal Finance Manager.

Routes:
  GET   /transactions      — list with filters + pagination
  PATCH /transactions/{id} — manually set category
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, asc, desc
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Account, Category, Rule, SuggestedRule, Transaction
from app.schemas import BulkCategoriseRequest, BulkCategoriseResponse, TransactionPatchResponse, TransactionResponse, TransactionUpdate
from app.services.pattern_extractor import AUTO_PROMOTE_THRESHOLD, extract_merchant_pattern

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _tx_to_response(tx: Transaction) -> dict:
    """Build a TransactionResponse dict including computed relationship fields."""
    data = TransactionResponse.model_validate(tx).model_dump()
    data["category_name"] = tx.category.name if tx.category else None
    data["transfer_account_name"] = tx.transfer_account.account_name if tx.transfer_account else None
    return data


@router.get("")
async def list_transactions(
    account_id: int | None = Query(default=None, description="Filter by account"),
    tx_type: str | None = Query(default=None, pattern="^(Income|Expense)$"),
    search: str | None = Query(default=None, description="Search in description"),
    categorised: bool | None = Query(default=None, description="Filter by categorised status"),
    sort_by: str = Query(default="tx_date", pattern="^(tx_date|tx_amount|tx_desc|tx_type)$"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List transactions with optional filters and pagination."""
    stmt = select(Transaction).options(
        selectinload(Transaction.category),
        selectinload(Transaction.transfer_account),
    )
    count_stmt = select(func.count(Transaction.id))

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

    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    col_map = {
        "tx_date": Transaction.tx_date,
        "tx_amount": Transaction.tx_amount,
        "tx_desc": Transaction.tx_desc,
        "tx_type": Transaction.tx_type,
    }
    sort_col = col_map[sort_by]
    order_expr = asc(sort_col) if sort_dir == "asc" else desc(sort_col)

    offset = (page - 1) * per_page
    stmt = stmt.order_by(order_expr, desc(Transaction.id))
    stmt = stmt.offset(offset).limit(per_page)

    result = await db.execute(stmt)
    transactions = result.scalars().all()

    return {
        "items": [_tx_to_response(tx) for tx in transactions],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if total > 0 else 0,
    }


@router.patch("/{tx_id}", response_model=TransactionPatchResponse)
async def patch_transaction(
    tx_id: int,
    body: TransactionUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually set (or clear) a transaction's category.

    - Pass category_id (int) to assign a category → marks is_categorised=True
    - Pass category_id=null to remove the category → marks is_categorised=False
    """
    result = await db.execute(
        select(Transaction)
        .options(selectinload(Transaction.category), selectinload(Transaction.transfer_account))
        .where(Transaction.id == tx_id)
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if "category_id" in body.model_fields_set:
        if body.category_id is not None:
            cat = await db.get(Category, body.category_id)
            if not cat:
                raise HTTPException(status_code=404, detail="Category not found")
        tx.category_id = body.category_id
        tx.is_categorised = body.category_id is not None
        # Clear transfer account when category is removed or changed to non-transfer
        if body.category_id is None:
            tx.transfer_account_id = None

    if "transfer_account_id" in body.model_fields_set:
        if body.transfer_account_id is not None:
            acc = await db.get(Account, body.transfer_account_id)
            if not acc:
                raise HTTPException(status_code=404, detail="Transfer account not found")
        tx.transfer_account_id = body.transfer_account_id

    await db.commit()

    # Expire cached relationships so reload fetches updated values
    db.expire(tx, ["category", "transfer_account"])
    result = await db.execute(
        select(Transaction)
        .options(selectinload(Transaction.category), selectinload(Transaction.transfer_account))
        .where(Transaction.id == tx_id)
    )
    tx = result.scalar_one()
    response = _tx_to_response(tx)

    # Find similar uncategorised transactions (same first 3 words of description)
    if body.category_id is not None:
        words = tx.tx_desc.split()[:3]
        if words:
            prefix = " ".join(words)
            similar_count_result = await db.execute(
                select(func.count(Transaction.id)).where(
                    Transaction.id != tx_id,
                    Transaction.is_categorised == False,
                    Transaction.tx_desc.ilike(f"{prefix}%"),
                )
            )
            response["similar_uncategorised"] = similar_count_result.scalar() or 0
            response["similar_prefix"] = prefix
        else:
            response["similar_uncategorised"] = 0
            response["similar_prefix"] = None
    else:
        response["similar_uncategorised"] = 0
        response["similar_prefix"] = None

    # ── Rule learning: extract pattern + upsert suggestion ───────────────────
    rule_suggestion = None
    if body.category_id is not None:
        pattern = extract_merchant_pattern(tx.tx_desc)
        if pattern:
            # Check if an active rule already covers this pattern → no need to suggest
            existing_rule_result = await db.execute(
                select(Rule).where(
                    Rule.pattern == pattern,
                    Rule.category_id == body.category_id,
                    Rule.is_active == True,
                )
            )
            has_rule = existing_rule_result.scalar_one_or_none() is not None

            if not has_rule:
                # Find an existing pending suggestion for same pattern+category
                existing_result = await db.execute(
                    select(SuggestedRule).where(
                        SuggestedRule.pattern == pattern,
                        SuggestedRule.category_id == body.category_id,
                        SuggestedRule.status == "pending",
                    )
                )
                suggestion = existing_result.scalar_one_or_none()

                auto_promoted = False
                if suggestion:
                    # Increment hit count
                    suggestion.hit_count += 1
                    ids = json.loads(suggestion.source_tx_ids or "[]")
                    if tx_id not in ids:
                        ids.append(tx_id)
                    suggestion.source_tx_ids = json.dumps(ids)

                    # Option B: auto-promote when threshold reached
                    if suggestion.hit_count >= AUTO_PROMOTE_THRESHOLD:
                        new_rule = Rule(pattern=pattern, category_id=body.category_id)
                        db.add(new_rule)
                        await db.flush()
                        suggestion.status = "auto_promoted"
                        suggestion.promoted_rule_id = new_rule.id
                        auto_promoted = True

                    await db.commit()
                    rule_suggestion = {
                        "suggestion_id": suggestion.id,
                        "pattern": pattern,
                        "category_id": body.category_id,
                        "category_name": tx.category.name if tx.category else "",
                        "hit_count": suggestion.hit_count,
                        "auto_promoted": auto_promoted,
                    }
                else:
                    # Create new suggestion
                    new_suggestion = SuggestedRule(
                        pattern=pattern,
                        category_id=body.category_id,
                        hit_count=1,
                        status="pending",
                        source_tx_ids=json.dumps([tx_id]),
                    )
                    db.add(new_suggestion)
                    await db.commit()
                    await db.refresh(new_suggestion)
                    rule_suggestion = {
                        "suggestion_id": new_suggestion.id,
                        "pattern": pattern,
                        "category_id": body.category_id,
                        "category_name": tx.category.name if tx.category else "",
                        "hit_count": 1,
                        "auto_promoted": False,
                    }

    response["rule_suggestion"] = rule_suggestion
    return response


@router.post("/bulk-categorise", response_model=BulkCategoriseResponse)
async def bulk_categorise(body: BulkCategoriseRequest, db: AsyncSession = Depends(get_db)):
    """Set the same category on multiple transactions at once."""
    cat = await db.get(Category, body.category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    result = await db.execute(
        select(Transaction).where(Transaction.id.in_(body.transaction_ids))
    )
    transactions = result.scalars().all()

    for tx in transactions:
        tx.category_id = body.category_id
        tx.is_categorised = True

    await db.commit()
    return BulkCategoriseResponse(
        updated=len(transactions),
        category_id=cat.id,
        category_name=cat.name,
    )
