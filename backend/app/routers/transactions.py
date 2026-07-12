"""
Transaction endpoints for Personal Finance Manager.

Routes:
  GET   /transactions      — list with filters + pagination
  PATCH /transactions/{id} — manually set category
"""

import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, case, asc, desc, or_, literal
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Account, Category, Rule, SuggestedRule, Transaction
from app.schemas import BulkCategoriseRequest, BulkCategoriseResponse, SplitRequest, TransactionPatchResponse, TransactionResponse, TransactionUpdate
from app.services.categoriser import TRANSFER_CATEGORY_NAMES, _link_counterpart
from app.services.pattern_extractor import AUTO_PROMOTE_THRESHOLD, extract_merchant_pattern

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _tx_to_response(tx: Transaction) -> dict:
    """Build a TransactionResponse dict including computed relationship fields."""
    data = TransactionResponse.model_validate(tx).model_dump()
    data["category_name"] = tx.category.name if tx.category else None
    if tx.transfer_account:
        acc = tx.transfer_account
        last4 = acc.account_number[-4:] if acc.account_number and len(acc.account_number) >= 4 else acc.account_number
        data["transfer_account_name"] = f"{acc.account_name} (****{last4})"
    else:
        data["transfer_account_name"] = None
    data["lending_loan_name"] = tx.lending_loan.loan_name if tx.lending_loan else None
    data["is_split_parent"] = tx.is_split_parent
    data["parent_transaction_id"] = tx.parent_transaction_id
    # Nested splits — access via __dict__ to avoid triggering lazy loading
    # (which raises MissingGreenlet in async context). selectinload populates
    # the key in __dict__ as an InstrumentedList; non-loaded rels are absent.
    raw_splits = tx.__dict__.get("splits")
    if raw_splits is not None and len(raw_splits) > 0:
        data["splits"] = [_tx_to_response(s) for s in raw_splits]
    else:
        data["splits"] = None
    return data


@router.get("")
async def list_transactions(
    account_id: int | None = Query(default=None, description="Filter by account"),
    tx_type: str | None = Query(default=None, pattern="^(Income|Expense)$"),
    search: str | None = Query(default=None, description="Search in description"),
    categorised: bool | None = Query(default=None, description="Filter by categorised status"),
    category_id: int | None = Query(default=None, description="Filter by specific category"),
    date_from: date | None = Query(default=None, description="Filter from date (inclusive) YYYY-MM-DD"),
    date_to: date | None = Query(default=None, description="Filter to date (inclusive) YYYY-MM-DD"),
    sort_by: str = Query(default="tx_date", pattern="^(tx_date|tx_amount|tx_desc|tx_type|category)$"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    uncategorised_first: bool = Query(default=True, description="Pin uncategorised rows to top"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List transactions with optional filters and pagination."""
    stmt = select(Transaction).options(
        selectinload(Transaction.category),
        selectinload(Transaction.transfer_account),
        selectinload(Transaction.lending_loan),
        selectinload(Transaction.splits).options(
            selectinload(Transaction.category),
            selectinload(Transaction.transfer_account),
            selectinload(Transaction.lending_loan),
        ),
    )
    count_stmt = select(func.count(Transaction.id))

    stmt = stmt.where(Transaction.parent_transaction_id.is_(None))
    count_stmt = count_stmt.where(Transaction.parent_transaction_id.is_(None))

    if account_id:
        stmt = stmt.where(Transaction.account_id == account_id)
        count_stmt = count_stmt.where(Transaction.account_id == account_id)
    if tx_type:
        stmt = stmt.where(Transaction.tx_type == tx_type)
        count_stmt = count_stmt.where(Transaction.tx_type == tx_type)
    if search:
        desc_match = Transaction.tx_desc.ilike(f"%{search}%")
        conditions = [desc_match]
        try:
            amount = abs(float(search.replace(",", "").replace("$", "")))
            if amount > 0:
                conditions.append(Transaction.tx_amount == amount)
        except ValueError:
            pass
        search_filter = or_(*conditions)
        stmt = stmt.where(search_filter)
        count_stmt = count_stmt.where(search_filter)
    if categorised is not None:
        stmt = stmt.where(Transaction.is_categorised == categorised)
        count_stmt = count_stmt.where(Transaction.is_categorised == categorised)
    if category_id is not None:
        stmt = stmt.where(Transaction.category_id == category_id)
        count_stmt = count_stmt.where(Transaction.category_id == category_id)
    if date_from is not None:
        stmt = stmt.where(Transaction.tx_date >= date_from)
        count_stmt = count_stmt.where(Transaction.tx_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Transaction.tx_date <= date_to)
        count_stmt = count_stmt.where(Transaction.tx_date <= date_to)

    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Build secondary sort expression (user-chosen column)
    if sort_by == "category":
        # Join categories for name-based sort; selectinload still handles data loading
        stmt = stmt.outerjoin(Category, Transaction.category_id == Category.id)
        secondary_order = asc(Category.name) if sort_dir == "asc" else desc(Category.name)
    else:
        col_map = {
            "tx_date": Transaction.tx_date,
            "tx_amount": Transaction.tx_amount,
            "tx_desc": Transaction.tx_desc,
            "tx_type": Transaction.tx_type,
        }
        secondary_order = asc(col_map[sort_by]) if sort_dir == "asc" else desc(col_map[sort_by])

    offset = (page - 1) * per_page
    order_clauses = []
    if uncategorised_first:
        order_clauses.append(asc(Transaction.is_categorised))
    order_clauses.extend([secondary_order, desc(Transaction.id)])
    stmt = stmt.order_by(*order_clauses)
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


@router.get("/count")
async def get_transaction_count(db: AsyncSession = Depends(get_db)):
    """Return global (all-time) transaction counts: total, categorised, uncategorised."""
    result = await db.execute(
        select(
            func.count(Transaction.id).label("total"),
            func.sum(case((Transaction.is_categorised == False, 1), else_=0)).label("uncategorised"),
        )
    )
    row = result.one()
    total = int(row.total or 0)
    uncategorised = int(row.uncategorised or 0)
    return {"total": total, "uncategorised": uncategorised, "categorised": total - uncategorised}


@router.get("/uncategorised-groups")
async def get_uncategorised_groups(db: AsyncSession = Depends(get_db)):
    """
    Groups uncategorised transactions by extracted merchant pattern.
    For each group, checks active rules then suggested_rules for a category suggestion.
    Returns list sorted by count DESC.
    """
    # Load all uncategorised transactions
    tx_result = await db.execute(
        select(Transaction).where(Transaction.is_categorised == False).order_by(Transaction.tx_date.desc())
    )
    transactions = tx_result.scalars().all()

    # Load accounts for name lookup
    acc_result = await db.execute(select(Account))
    accounts_map: dict[int, Account] = {a.id: a for a in acc_result.scalars().all()}

    # Group by exact description — identical descriptions are the same payee
    groups: dict[str, list] = defaultdict(list)
    for tx in transactions:
        groups[tx.tx_desc].append(tx)

    # Load active rules and suggested rules for suggestion lookup
    rules_result = await db.execute(
        select(Rule).where(Rule.is_active == True)
    )
    rules = {r.pattern.lower(): r for r in rules_result.scalars().all()}

    sugg_result = await db.execute(
        select(SuggestedRule)
        .where(SuggestedRule.status == "pending")
        .order_by(desc(SuggestedRule.hit_count))
    )
    suggestions_map: dict[str, SuggestedRule] = {}
    for s in sugg_result.scalars().all():
        if s.pattern.lower() not in suggestions_map:
            suggestions_map[s.pattern.lower()] = s

    # Load category names for suggestions
    cat_ids = set()
    for r in rules.values():
        cat_ids.add(r.category_id)
    for s in suggestions_map.values():
        cat_ids.add(s.category_id)

    cats = {}
    if cat_ids:
        cat_result = await db.execute(select(Category).where(Category.id.in_(cat_ids)))
        cats = {c.id: c for c in cat_result.scalars().all()}

    # Build response
    result = []
    for pattern_key, txs in sorted(groups.items(), key=lambda x: -len(x[1])):
        suggested_category_id = None
        suggested_category_name = None

        # Check rules first — find the first active rule whose pattern appears in this description
        desc_lower = pattern_key.lower()
        matched_rule = next(
            (r for pat, r in rules.items() if pat in desc_lower),
            None,
        )
        if matched_rule and matched_rule.category_id in cats:
            suggested_category_id = matched_rule.category_id
            suggested_category_name = cats[matched_rule.category_id].name
        else:
            # Fall back to suggested rules
            matched_sugg = next(
                (s for pat, s in suggestions_map.items() if pat in desc_lower),
                None,
            )
            if matched_sugg and matched_sugg.category_id in cats:
                suggested_category_id = matched_sugg.category_id
                suggested_category_name = cats[matched_sugg.category_id].name

        # Build per-transaction detail rows (sorted newest first)
        tx_rows = []
        for t in sorted(txs, key=lambda x: x.tx_date, reverse=True):
            acc = accounts_map.get(t.account_id)
            acc_name = acc.account_name if acc else f"#{t.account_id}"
            tx_rows.append({
                "id": t.id,
                "tx_date": t.tx_date.strftime("%Y-%m-%d"),
                "tx_amount": float(t.tx_amount),
                "tx_type": t.tx_type,
                "tx_desc": t.tx_desc,
                "account_name": acc_name,
            })

        result.append({
            "description": pattern_key,
            "count": len(txs),
            "total_amount": round(sum(abs(t.tx_amount) for t in txs), 2),
            "transaction_ids": [t.id for t in txs],
            "dates": sorted(set(t.tx_date.strftime("%Y-%m-%d") for t in txs), reverse=True)[:3],
            "suggested_category_id": suggested_category_id,
            "suggested_category_name": suggested_category_name,
            "transactions": tx_rows,
        })

    return result


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
        .options(selectinload(Transaction.category), selectinload(Transaction.transfer_account), selectinload(Transaction.lending_loan))
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

    if body.lending_loan_id is not None:
        if body.lending_loan_id == -1:
            tx.lending_loan_id = None
            tx.lending_tx_type = None
        else:
            if not body.lending_tx_type:
                raise HTTPException(status_code=422, detail="lending_tx_type required when linking a loan")
            tx.lending_loan_id = body.lending_loan_id
            tx.lending_tx_type = body.lending_tx_type
    elif body.lending_tx_type is not None and tx.lending_loan_id:
        tx.lending_tx_type = body.lending_tx_type

    await db.commit()

    # Expire cached relationships so reload fetches updated values
    db.expire(tx, ["category", "transfer_account", "lending_loan"])
    result = await db.execute(
        select(Transaction)
        .options(selectinload(Transaction.category), selectinload(Transaction.transfer_account), selectinload(Transaction.lending_loan))
        .where(Transaction.id == tx_id)
    )
    tx = result.scalar_one()
    response = _tx_to_response(tx)

    # ── Transfer auto-matching ────────────────────────────────────────────────
    # When a transfer category + linked account is saved, automatically find and
    # link the counterpart transaction on the other account.
    transfer_matched_account = None
    if tx.transfer_account_id and tx.is_categorised and tx.category:
        cat_name = tx.category.name.lower()
        if "transfer" in cat_name:
            opp_name = "Transfer In" if "out" in cat_name else "Transfer Out"
            opp_cat_result = await db.execute(
                select(Category).where(Category.name == opp_name)
            )
            opp_cat = opp_cat_result.scalar_one_or_none()
            if opp_cat:
                date_from = tx.tx_date - timedelta(days=2)
                date_to = tx.tx_date + timedelta(days=2)
                counterpart_result = await db.execute(
                    select(Transaction).where(
                        Transaction.account_id == tx.transfer_account_id,
                        Transaction.tx_amount == tx.tx_amount,
                        Transaction.tx_date.between(date_from, date_to),
                        Transaction.id != tx_id,
                        # Skip if already linked to a different account
                        (Transaction.transfer_account_id.is_(None))
                        | (Transaction.transfer_account_id == tx.account_id),
                    ).order_by(
                        func.abs(func.datediff(Transaction.tx_date, tx.tx_date))
                    ).limit(1)
                )
                counterpart = counterpart_result.scalar_one_or_none()
                if counterpart:
                    counterpart.category_id = opp_cat.id
                    counterpart.is_categorised = True
                    counterpart.transfer_account_id = tx.account_id
                    await db.commit()
                    transfer_matched_account = (
                        tx.transfer_account.account_name if tx.transfer_account else None
                    )

    response["transfer_matched_account"] = transfer_matched_account

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
            # Check if any active rule with the same category already matches
            # this transaction description as a substring (same logic as categoriser).
            existing_rule_result = await db.execute(
                select(Rule).where(
                    literal(tx.tx_desc).ilike(func.concat("%", Rule.pattern, "%")),
                    Rule.category_id == body.category_id,
                    Rule.is_active == True,
                )
            )
            has_rule = existing_rule_result.scalar_one_or_none() is not None

            if not has_rule:
                # Find an existing pending suggestion for same pattern+category
                # (case-insensitive to avoid creating near-duplicates)
                existing_result = await db.execute(
                    select(SuggestedRule).where(
                        func.lower(SuggestedRule.pattern) == pattern.lower(),
                        SuggestedRule.category_id == body.category_id,
                        SuggestedRule.status == "pending",
                    )
                )
                suggestion = existing_result.scalar_one_or_none()

                # Ambiguity guard: if other already-categorised transactions whose
                # description matches this pattern were categorised with a DIFFERENT
                # category, the merchant is ambiguous — skip suggestion creation.
                conflict_result = await db.execute(
                    select(func.count(Transaction.id)).where(
                        Transaction.tx_desc.ilike(f"%{pattern}%"),
                        Transaction.is_categorised == True,
                        Transaction.category_id != body.category_id,
                        Transaction.id != tx_id,
                    )
                )
                conflict_count = conflict_result.scalar() or 0

                auto_promoted = False
                if suggestion:
                    # Increment hit count
                    suggestion.hit_count += 1
                    ids = json.loads(suggestion.source_tx_ids or "[]")
                    if tx_id not in ids:
                        ids.append(tx_id)
                    suggestion.source_tx_ids = json.dumps(ids)

                    # Keep transfer_account_id in sync with the latest manual categorisation
                    suggestion.transfer_account_id = tx.transfer_account_id

                    # Option B: auto-promote when threshold reached
                    if suggestion.hit_count >= AUTO_PROMOTE_THRESHOLD:
                        new_rule = Rule(
                            pattern=pattern,
                            category_id=body.category_id,
                            transfer_account_id=tx.transfer_account_id,
                        )
                        db.add(new_rule)
                        await db.flush()
                        suggestion.status = "auto_promoted"
                        suggestion.promoted_rule_id = new_rule.id
                        auto_promoted = True

                    await db.commit()
                    # Only surface the suggestion when there's no ambiguity
                    if conflict_count == 0:
                        rule_suggestion = {
                            "suggestion_id": suggestion.id,
                            "pattern": pattern,
                            "category_id": body.category_id,
                            "category_name": tx.category.name if tx.category else "",
                            "hit_count": suggestion.hit_count,
                            "auto_promoted": auto_promoted,
                        }
                elif conflict_count == 0:
                    # Only create a new suggestion when the pattern is unambiguous
                    new_suggestion = SuggestedRule(
                        pattern=pattern,
                        category_id=body.category_id,
                        transfer_account_id=tx.transfer_account_id,
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


@router.post("/{tx_id}/split", response_model=dict)
async def split_transaction(
    tx_id: int,
    body: SplitRequest,
    db: AsyncSession = Depends(get_db),
):
    """Split a transaction into N child transactions."""
    result = await db.execute(
        select(Transaction)
        .options(
            selectinload(Transaction.category),
            selectinload(Transaction.transfer_account),
            selectinload(Transaction.lending_loan),
            selectinload(Transaction.splits),
        )
        .where(Transaction.id == tx_id)
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx.parent_transaction_id is not None:
        raise HTTPException(status_code=400, detail="Cannot split a child transaction")

    # Validate sum within ±$0.01
    total = round(sum(s.amount for s in body.splits), 2)
    if abs(total - tx.tx_amount) > 0.01:
        raise HTTPException(
            status_code=422,
            detail=f"Split amounts sum to {total:.2f} but transaction amount is {tx.tx_amount:.2f}",
        )

    # Delete existing children (re-split)
    for child in list(tx.splits):
        await db.delete(child)
    await db.flush()

    # Mark parent
    tx.is_split_parent = True

    # Create children
    for i, split in enumerate(body.splits):
        raw = f"{tx_id}|{i}|{split.amount}"
        child_hash = hashlib.sha256(raw.encode()).hexdigest()
        child = Transaction(
            account_id=tx.account_id,
            tx_date=tx.tx_date,
            tx_desc=split.description,
            tx_amount=split.amount,
            tx_type=tx.tx_type,
            tx_hash=child_hash,
            is_categorised=split.category_id is not None,
            category_id=split.category_id,
            lending_loan_id=split.lending_loan_id,
            lending_tx_type=split.lending_tx_type,
            parent_transaction_id=tx_id,
            is_split_parent=False,
        )
        db.add(child)

    await db.commit()

    # Expire the cached 'splits' relationship on the parent object so that the
    # subsequent selectinload query fetches fresh data from the DB (not the
    # identity-map cache which was populated with [] before children existed).
    db.expire(tx, ["splits", "category", "transfer_account", "lending_loan"])

    # Reload with children
    result = await db.execute(
        select(Transaction)
        .options(
            selectinload(Transaction.category),
            selectinload(Transaction.transfer_account),
            selectinload(Transaction.lending_loan),
            selectinload(Transaction.splits).options(
                selectinload(Transaction.category),
                selectinload(Transaction.transfer_account),
                selectinload(Transaction.lending_loan),
            ),
        )
        .where(Transaction.id == tx_id)
    )
    tx = result.scalar_one()
    return _tx_to_response(tx)


@router.delete("/{tx_id}/split", response_model=dict)
async def unsplit_transaction(
    tx_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Remove all child splits and restore the original transaction."""
    result = await db.execute(
        select(Transaction)
        .options(
            selectinload(Transaction.category),
            selectinload(Transaction.transfer_account),
            selectinload(Transaction.lending_loan),
            selectinload(Transaction.splits),
        )
        .where(Transaction.id == tx_id)
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if not tx.is_split_parent:
        raise HTTPException(status_code=400, detail="Transaction is not a split parent")

    for child in list(tx.splits):
        await db.delete(child)
    tx.is_split_parent = False
    await db.commit()

    db.expire(tx, ["category", "transfer_account", "lending_loan", "splits"])
    result = await db.execute(
        select(Transaction)
        .options(
            selectinload(Transaction.category),
            selectinload(Transaction.transfer_account),
            selectinload(Transaction.lending_loan),
        )
        .where(Transaction.id == tx_id)
    )
    tx = result.scalar_one()
    return _tx_to_response(tx)


@router.delete("")
async def delete_transactions_by_account(
    account_id: int = Query(..., description="Account whose transactions to delete"),
    db: AsyncSession = Depends(get_db),
):
    """Delete all transactions for a given account. Requires account_id query param."""
    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    result = await db.execute(
        select(func.count(Transaction.id)).where(Transaction.account_id == account_id)
    )
    count = result.scalar() or 0

    await db.execute(
        Transaction.__table__.delete().where(Transaction.account_id == account_id)
    )
    await db.commit()
    return {"deleted": count, "account_id": account_id}


@router.post("/bulk-categorise", response_model=BulkCategoriseResponse)
async def bulk_categorise(body: BulkCategoriseRequest, db: AsyncSession = Depends(get_db)):
    """Set the same category (and optionally transfer_account_id) on multiple transactions."""
    cat = await db.get(Category, body.category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    if body.transfer_account_id is not None:
        acc = await db.get(Account, body.transfer_account_id)
        if not acc:
            raise HTTPException(status_code=404, detail="Transfer account not found")

    result = await db.execute(
        select(Transaction).where(Transaction.id.in_(body.transaction_ids))
    )
    transactions = result.scalars().all()

    is_transfer = cat.name in TRANSFER_CATEGORY_NAMES

    for tx in transactions:
        tx.category_id = body.category_id
        tx.is_categorised = True
        if is_transfer and body.transfer_account_id is not None:
            tx.transfer_account_id = body.transfer_account_id

    await db.commit()

    # Bidirectional linking for Transfer transactions
    if is_transfer and body.transfer_account_id is not None:
        opp_name = "Transfer In" if cat.name == "Transfer Out" else "Transfer Out"
        opp_cat_result = await db.execute(select(Category).where(Category.name == opp_name))
        opp_cat = opp_cat_result.scalar_one_or_none()
        if opp_cat:
            for tx in transactions:
                await _link_counterpart(db, tx, opp_cat.id)
            await db.commit()

    return BulkCategoriseResponse(
        updated=len(transactions),
        category_id=cat.id,
        category_name=cat.name,
    )
