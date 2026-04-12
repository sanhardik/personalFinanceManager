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
from app.models import Category, Rule, SuggestedRule, Transaction
from app.schemas import AffectedTransaction, RuleAffectedResponse, RuleCreate, RuleResponse, RuleUpdate, SuggestedRuleResponse
from app.services.categoriser import apply_rules_to_transactions

router = APIRouter(prefix="/rules", tags=["rules"])


def _rule_to_response(rule: Rule) -> RuleResponse:
    return RuleResponse.model_validate(rule)


@router.get("", response_model=list[RuleResponse])
async def list_rules(db: AsyncSession = Depends(get_db)):
    """List all rules with their associated category."""
    result = await db.execute(
        select(Rule).options(selectinload(Rule.category)).order_by(Rule.id)
    )
    return [_rule_to_response(r) for r in result.scalars().all()]


@router.post("", response_model=RuleResponse, status_code=201)
async def create_rule(body: RuleCreate, db: AsyncSession = Depends(get_db)):
    """Create a new auto-categorisation rule."""
    cat = await db.get(Category, body.category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    rule = Rule(pattern=body.pattern, category_id=body.category_id)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    # Reload with relationship
    result = await db.execute(
        select(Rule).options(selectinload(Rule.category)).where(Rule.id == rule.id)
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

    await db.commit()

    # Expire cached relationship before reload to avoid stale identity map
    db.expire(rule, ["category"])
    result = await db.execute(
        select(Rule).options(selectinload(Rule.category)).where(Rule.id == rule_id)
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
        rule = Rule(pattern=suggestion.pattern, category_id=suggestion.category_id)
        db.add(rule)
        await db.flush()

    suggestion.status = "accepted"
    suggestion.promoted_rule_id = rule.id
    await db.commit()

    # Reload rule with category relationship
    result = await db.execute(
        select(Rule).options(selectinload(Rule.category)).where(Rule.id == rule.id)
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
    Re-apply this rule's current category to ALL matching transactions,
    regardless of their current category. Call after PUT /rules/{id} to
    propagate a category change to existing transactions.
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

    updated = 0
    for tx in transactions:
        if tx.category_id != rule.category_id:
            tx.category_id = rule.category_id
            tx.is_categorised = True
            updated += 1

    if updated:
        await db.commit()

    return {
        "updated": updated,
        "category_name": rule.category.name,
        "pattern": rule.pattern,
    }
