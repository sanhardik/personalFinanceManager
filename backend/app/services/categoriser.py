"""
Categorisation service — applies Rules to Transactions.

A rule matches if its pattern (case-insensitive) appears anywhere in tx_desc.
First matching rule wins (ordered by rule.id ascending).
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Rule, Transaction

logger = logging.getLogger(__name__)


async def apply_rules_to_transactions(
    db: AsyncSession,
    transaction_ids: list[int] | None = None,
) -> int:
    """
    Apply all active rules to uncategorised transactions.

    Args:
        db: Async DB session.
        transaction_ids: Optional list of specific transaction IDs to process.
                         If None, processes all uncategorised transactions.

    Returns:
        Number of transactions that were categorised.
    """
    # Load all active rules ordered by creation (first created = highest priority)
    rules_result = await db.execute(
        select(Rule).where(Rule.is_active == True).order_by(Rule.id)
    )
    rules = rules_result.scalars().all()

    if not rules:
        return 0

    # Load target transactions
    stmt = select(Transaction).where(Transaction.is_categorised == False)
    if transaction_ids:
        stmt = stmt.where(Transaction.id.in_(transaction_ids))

    tx_result = await db.execute(stmt)
    transactions = tx_result.scalars().all()

    categorised_count = 0
    for tx in transactions:
        for rule in rules:
            if rule.pattern.lower() in tx.tx_desc.lower():
                tx.category_id = rule.category_id
                tx.is_categorised = True
                categorised_count += 1
                break  # First matching rule wins

    if categorised_count > 0:
        await db.commit()
        logger.info("Categorised %d transactions via rules", categorised_count)

    return categorised_count
