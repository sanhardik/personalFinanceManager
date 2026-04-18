"""
Rules endpoints for auto-categorisation.

Routes:
  GET    /rules            — list all rules (with category info)
  POST   /rules            — create a rule
  PUT    /rules/{id}       — update a rule
  DELETE /rules/{id}       — delete a rule
  POST   /rules/apply      — bulk apply all active rules to uncategorised transactions
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Account, Category, Rule, SuggestedRule, Transaction
from app.schemas import AffectedTransaction, RuleAffectedResponse, RuleCreate, RuleResponse, RuleUpdate, SuggestedRuleResponse
from app.services.categoriser import TRANSFER_CATEGORY_NAMES, _extract_account_suffixes, _link_counterpart, _match_account, apply_rules_to_transactions

router = APIRouter(prefix="/rules", tags=["rules"])


def _rule_to_response(rule: Rule) -> RuleResponse:
    data = RuleResponse.model_validate(rule)
    # Populate transfer_account_name from the eagerly-loaded relationship
    if rule.transfer_account is not None:
        data.transfer_account_name = rule.transfer_account.account_name or rule.transfer_account.account_number
    return data


@router.get("", response_model=list[RuleResponse])
async def list_rules(db: AsyncSession = Depends(get_db)):
    """List all rules with their associated category."""
    result = await db.execute(
        select(Rule)
        .options(selectinload(Rule.category), selectinload(Rule.transfer_account))
        .order_by(Rule.id)
    )
    return [_rule_to_response(r) for r in result.scalars().all()]


@router.post("", response_model=RuleResponse, status_code=201)
async def create_rule(body: RuleCreate, db: AsyncSession = Depends(get_db)):
    """Create a new auto-categorisation rule."""
    cat = await db.get(Category, body.category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    if body.transfer_account_id is not None:
        acc = await db.get(Account, body.transfer_account_id)
        if not acc:
            raise HTTPException(status_code=404, detail="Transfer account not found")

    rule = Rule(pattern=body.pattern, category_id=body.category_id, transfer_account_id=body.transfer_account_id)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    # Reload with relationships
    result = await db.execute(
        select(Rule)
        .options(selectinload(Rule.category), selectinload(Rule.transfer_account))
        .where(Rule.id == rule.id)
    )
    return _rule_to_response(result.scalar_one())


@router.put("/{rule_id}", response_model=RuleResponse)
async def update_rule(rule_id: int, body: RuleUpdate, db: AsyncSession = Depends(get_db)):
    """Update a rule's pattern, category, or active status."""
    result = await db.execute(
        select(Rule).options(selectinload(Rule.category)).where(Rule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    if body.pattern is not None:
        rule.pattern = body.pattern
    if body.category_id is not None:
        cat = await db.get(Category, body.category_id)
        if not cat:
            raise HTTPException(status_code=404, detail="Category not found")
        rule.category_id = body.category_id
    if body.is_active is not None:
        rule.is_active = body.is_active
    if "transfer_account_id" in body.model_fields_set:
        if body.transfer_account_id is not None:
            acc = await db.get(Account, body.transfer_account_id)
            if not acc:
                raise HTTPException(status_code=404, detail="Transfer account not found")
        rule.transfer_account_id = body.transfer_account_id

    await db.commit()

    # Expire cached relationships before reload to avoid stale identity map
    db.expire(rule, ["category", "transfer_account"])
    result = await db.execute(
        select(Rule)
        .options(selectinload(Rule.category), selectinload(Rule.transfer_account))
        .where(Rule.id == rule_id)
    )
    return _rule_to_response(result.scalar_one())


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a rule."""
    rule = await db.get(Rule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
    await db.commit()


@router.get("/suggestions", response_model=list[SuggestedRuleResponse])
async def list_suggestions(db: AsyncSession = Depends(get_db)):
    """
    List all pending rule suggestions ordered by hit count descending.

    These are patterns extracted from manual categorisation. Use Accept to
    promote to a real rule, or Dismiss to hide permanently.
    """
    result = await db.execute(
        select(SuggestedRule)
        .options(selectinload(SuggestedRule.category))
        .where(SuggestedRule.status == "pending")
        .order_by(desc(SuggestedRule.hit_count), SuggestedRule.id)
    )
    return [SuggestedRuleResponse.model_validate(s) for s in result.scalars().all()]


@router.post("/suggestions/{suggestion_id}/accept", response_model=RuleResponse)
async def accept_suggestion(suggestion_id: int, db: AsyncSession = Depends(get_db)):
    """
    Accept a suggested rule — promotes it to a real active rule.

    If a matching rule already exists (same pattern + category), links to it
    instead of creating a duplicate.
    """
    result = await db.execute(
        select(SuggestedRule)
        .options(selectinload(SuggestedRule.category))
        .where(SuggestedRule.id == suggestion_id)
    )
    suggestion = result.scalar_one_or_none()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if suggestion.status != "pending":
        raise HTTPException(status_code=409, detail=f"Suggestion already {suggestion.status}")

    # Reuse existing rule if one already exists for this pattern+category
    existing_result = await db.execute(
        select(Rule).where(
            Rule.pattern == suggestion.pattern,
            Rule.category_id == suggestion.category_id,
        )
    )
    rule = existing_result.scalar_one_or_none()

    if not rule:
        rule = Rule(
            pattern=suggestion.pattern,
            category_id=suggestion.category_id,
            transfer_account_id=suggestion.transfer_account_id,
        )
        db.add(rule)
        await db.flush()

    suggestion.status = "accepted"
    suggestion.promoted_rule_id = rule.id
    await db.commit()

    # Reload rule with relationships
    result = await db.execute(
        select(Rule)
        .options(selectinload(Rule.category), selectinload(Rule.transfer_account))
        .where(Rule.id == rule.id)
    )
    return _rule_to_response(result.scalar_one())


@router.post("/suggestions/{suggestion_id}/dismiss", status_code=204)
async def dismiss_suggestion(suggestion_id: int, db: AsyncSession = Depends(get_db)):
    """Mark a suggested rule as dismissed — it will no longer appear in the queue."""
    suggestion = await db.get(SuggestedRule, suggestion_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    suggestion.status = "dismissed"
    await db.commit()


@router.post("/apply")
async def apply_rules(db: AsyncSession = Depends(get_db)):
    """Bulk apply all active rules to all uncategorised transactions."""
    count = await apply_rules_to_transactions(db)
    return {"categorised": count, "message": f"Applied rules: {count} transactions categorised"}


@router.get("/{rule_id}/affected", response_model=RuleAffectedResponse)
async def get_affected_transactions(rule_id: int, db: AsyncSession = Depends(get_db)):
    """
    Return transactions that match this rule's pattern AND currently have this
    rule's category — i.e. transactions that were (likely) categorised by this rule.

    Call this before changing a rule's category to show the user what would be
    re-categorised.
    """
    result = await db.execute(
        select(Rule).options(selectinload(Rule.category)).where(Rule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    tx_result = await db.execute(
        select(Transaction)
        .where(
            Transaction.tx_desc.ilike(f"%{rule.pattern}%"),
            Transaction.category_id == rule.category_id,
        )
        .order_by(desc(Transaction.tx_date))
    )
    transactions = tx_result.scalars().all()

    return RuleAffectedResponse(
        count=len(transactions),
        old_category_id=rule.category_id,
        old_category_name=rule.category.name,
        transactions=[AffectedTransaction.model_validate(tx) for tx in transactions],
    )


@router.post("/{rule_id}/recategorise")
async def recategorise_by_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """
    Re-apply this rule's current category (and transfer_account_id) to ALL
    matching transactions, regardless of their current category or categorised
    state. Call after PUT /rules/{id} to propagate changes to existing transactions.

    For Transfer In/Out rules:
    - Sets transfer_account_id from the rule if present, else extracts from description.
    - Runs bidirectional counterpart linking after commit.
    """
    result = await db.execute(
        select(Rule).options(selectinload(Rule.category)).where(Rule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    tx_result = await db.execute(
        select(Transaction).where(Transaction.tx_desc.ilike(f"%{rule.pattern}%"))
    )
    transactions = tx_result.scalars().all()

    # Determine if this is a Transfer category
    is_transfer = rule.category.name in TRANSFER_CATEGORY_NAMES

    # Load accounts once if we need transfer account resolution
    accounts: list[Account] = []
    transfer_cat_ids: dict[str, int] = {}
    if is_transfer:
        acc_result = await db.execute(select(Account))
        accounts = acc_result.scalars().all()
        cat_result = await db.execute(
            select(Category).where(Category.name.in_(TRANSFER_CATEGORY_NAMES))
        )
        for cat in cat_result.scalars().all():
            transfer_cat_ids[cat.name] = cat.id

    updated = 0
    transfer_txs: list[Transaction] = []

    for tx in transactions:
        changed = False

        if tx.category_id != rule.category_id:
            tx.category_id = rule.category_id
            tx.is_categorised = True
            changed = True

        if is_transfer:
            # Resolve transfer_account_id: rule value → description extraction → keep existing
            new_transfer_id: int | None = tx.transfer_account_id
            if rule.transfer_account_id:
                new_transfer_id = rule.transfer_account_id
            elif not tx.transfer_account_id and accounts:
                suffixes = _extract_account_suffixes(tx.tx_desc)
                matched_id = _match_account(suffixes, accounts, tx.account_id)
                if matched_id:
                    new_transfer_id = matched_id

            if new_transfer_id != tx.transfer_account_id:
                tx.transfer_account_id = new_transfer_id
                changed = True

            if tx.transfer_account_id:
                transfer_txs.append(tx)

        if changed:
            tx.is_categorised = True
            updated += 1

    if updated:
        await db.commit()

        # Bidirectional linking for Transfer transactions
        for tx in transfer_txs:
            opp_name = "Transfer In" if rule.category.name == "Transfer Out" else "Transfer Out"
            opp_cat_id = transfer_cat_ids.get(opp_name)
            if opp_cat_id:
                await _link_counterpart(db, tx, opp_cat_id)

        await db.commit()

    return {
        "updated": updated,
        "category_name": rule.category.name,
        "pattern": rule.pattern,
    }
