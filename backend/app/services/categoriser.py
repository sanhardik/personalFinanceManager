"""
Categorisation service — applies Rules to Transactions.

A rule matches if its pattern (case-insensitive) appears anywhere in tx_desc.
First matching rule wins (ordered by rule.id ascending).

Transfer In / Transfer Out rules additionally attempt to resolve the linked
account by extracting a suffix from the transaction description (e.g. "xx4046"
→ last 4 digits) and matching against known accounts.  If exactly one account
matches, transfer_account_id is set and the counterpart transaction is
bidirectionally linked.
"""

import logging
import re
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, Rule, Transaction

logger = logging.getLogger(__name__)

# Matches account suffix hints in descriptions, e.g. xx4046, x4046, xxxx4046
_ACCOUNT_SUFFIX_RE = re.compile(r"\bx+(\d{3,})\b", re.IGNORECASE)

TRANSFER_CATEGORY_NAMES = {"Transfer In", "Transfer Out"}


def _extract_account_suffix(tx_desc: str) -> list[str]:
    """Return all digit suffixes found after 'x+' patterns in the description."""
    return _ACCOUNT_SUFFIX_RE.findall(tx_desc)


def _match_account(suffixes: list[str], accounts: list[Account]) -> int | None:
    """
    Return the account id if exactly one account's number ends with any of the
    extracted suffixes.  Returns None if zero or multiple accounts match
    (ambiguous — safer to leave transfer_account_id unset).
    """
    for suffix in suffixes:
        matched = [acc for acc in accounts if acc.account_number.endswith(suffix)]
        if len(matched) == 1:
            return matched[0].id
    return None


async def _link_counterpart(
    db: AsyncSession,
    tx: Transaction,
    opp_category_id: int,
) -> None:
    """
    Find the counterpart transaction on the transfer account and link both sides.
    Mirrors the auto-matching logic in PATCH /transactions/{id}.
    """
    if not tx.transfer_account_id:
        return

    date_from = tx.tx_date - timedelta(days=2)
    date_to = tx.tx_date + timedelta(days=2)

    counterpart_result = await db.execute(
        select(Transaction)
        .where(
            Transaction.account_id == tx.transfer_account_id,
            Transaction.tx_amount == tx.tx_amount,
            Transaction.tx_date.between(date_from, date_to),
            Transaction.id != tx.id,
            (Transaction.transfer_account_id.is_(None))
            | (Transaction.transfer_account_id == tx.account_id),
        )
        .order_by(func.abs(func.datediff(Transaction.tx_date, tx.tx_date)))
        .limit(1)
    )
    counterpart = counterpart_result.scalar_one_or_none()
    if counterpart:
        counterpart.category_id = opp_category_id
        counterpart.is_categorised = True
        counterpart.transfer_account_id = tx.account_id
        logger.info(
            "Auto-linked counterpart tx id=%d ↔ tx id=%d (accounts %d ↔ %d)",
            counterpart.id,
            tx.id,
            tx.transfer_account_id,
            tx.account_id,
        )


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

    # Pre-load data needed for transfer account resolution
    transfer_cat_ids: dict[str, int] = {}
    accounts: list[Account] = []

    # Check if any rule targets a Transfer category (avoid extra queries otherwise)
    transfer_rule_category_ids = set()
    for rule in rules:
        transfer_rule_category_ids.add(rule.category_id)

    if transfer_rule_category_ids:
        cat_result = await db.execute(
            select(Category).where(
                Category.name.in_(TRANSFER_CATEGORY_NAMES)
            )
        )
        for cat in cat_result.scalars().all():
            transfer_cat_ids[cat.name] = cat.id

        if transfer_cat_ids:
            # Only load accounts if there are Transfer categories in the rule set
            rule_targets_transfer = any(
                rule.category_id in transfer_cat_ids.values()
                for rule in rules
            )
            if rule_targets_transfer:
                acc_result = await db.execute(select(Account))
                accounts = acc_result.scalars().all()

    categorised_count = 0
    for tx in transactions:
        for rule in rules:
            if rule.pattern.lower() not in tx.tx_desc.lower():
                continue

            tx.category_id = rule.category_id
            tx.is_categorised = True

            # ── Transfer account resolution ───────────────────────────────────
            if rule.category_id in transfer_cat_ids.values():
                # 1. Rule already has a hardcoded transfer account — use it
                if rule.transfer_account_id:
                    tx.transfer_account_id = rule.transfer_account_id
                # 2. Try to extract account suffix from description
                elif accounts:
                    suffixes = _extract_account_suffix(tx.tx_desc)
                    matched_id = _match_account(suffixes, accounts)
                    if matched_id and matched_id != tx.account_id:
                        tx.transfer_account_id = matched_id
                        logger.info(
                            "Resolved transfer account id=%d for tx id=%d via desc suffix",
                            matched_id,
                            tx.id,
                        )

            categorised_count += 1
            break  # First matching rule wins

    if categorised_count > 0:
        await db.commit()
        logger.info("Categorised %d transactions via rules", categorised_count)

        # ── Bidirectional counterpart linking (post-commit) ───────────────────
        # Runs after the main commit so all category_ids are persisted before
        # we search for counterparts.
        for tx in transactions:
            if (
                tx.is_categorised
                and tx.transfer_account_id
                and tx.category_id in transfer_cat_ids.values()
            ):
                # Determine the opposite category
                cat_name = next(
                    (name for name, cid in transfer_cat_ids.items() if cid == tx.category_id),
                    None,
                )
                if cat_name:
                    opp_name = "Transfer In" if cat_name == "Transfer Out" else "Transfer Out"
                    opp_cat_id = transfer_cat_ids.get(opp_name)
                    if opp_cat_id:
                        await _link_counterpart(db, tx, opp_cat_id)

        await db.commit()

    return categorised_count
