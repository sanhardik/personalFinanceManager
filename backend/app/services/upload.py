"""
CSV upload service — orchestrates parsing, account creation, and transaction insertion.

Flow:
1. Read CSV content → detect bank parser
2. Parse transactions
3. Create/find accounts for each unique account number
4. Insert transactions (skip duplicates via SHA256 hash)
5. Return summary
"""

import logging
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, StockTrade, Transaction
from app.parsers.base import ParseResult, StockParseResult
from app.parsers.registry import detect_cash_parser, detect_parser, detect_stock_parser
from app.services.categoriser import apply_rules_to_transactions

logger = logging.getLogger(__name__)


@dataclass
class UploadResult:
    """Summary of a CSV upload operation."""

    bank_name: str
    accounts_found: list[str]
    account_ids: list[int]
    total_rows: int
    inserted: int
    duplicates: int
    errors: list[str]


async def _process_parse_result(
    result: ParseResult,
    db: AsyncSession,
    account_id_override: int | None = None,
) -> UploadResult:
    """
    Insert transactions from an already-parsed ParseResult.

    Shared by process_csv_upload (standard + cash parsers).
    """
    errors = list(result.errors)

    if not result.transactions:
        return UploadResult(
            bank_name=result.bank_name,
            accounts_found=result.accounts_found,
            account_ids=[],
            total_rows=result.row_count,
            inserted=0,
            duplicates=0,
            errors=errors or ["No transactions found in file"],
        )

    # Create/find accounts
    account_map: dict[str, int] = {}
    for tx in result.transactions:
        if tx.account_number not in account_map:
            if account_id_override:
                existing = await db.execute(
                    select(Account).where(Account.id == account_id_override)
                )
                if not existing.scalar_one_or_none():
                    raise ValueError(f"Account ID {account_id_override} not found")
                account_map[tx.account_number] = account_id_override
            else:
                account = await _get_or_create_account(
                    db=db,
                    account_number=tx.account_number,
                    bank_name=result.bank_name,
                    account_type=tx.account_type,
                    account_name=tx.account_name,
                )
                account_map[tx.account_number] = account.id

    # Insert transactions (skip duplicates)
    inserted = 0
    duplicates = 0

    for tx in result.transactions:
        account_id = account_map[tx.account_number]
        tx_hash = Transaction.compute_hash(
            account_id=account_id,
            tx_date=tx.tx_date.strftime("%Y-%m-%d"),
            tx_desc=tx.tx_desc,
            tx_amount=tx.tx_amount,
        )

        existing = await db.execute(
            select(Transaction).where(Transaction.tx_hash == tx_hash)
        )
        if existing.scalar_one_or_none():
            duplicates += 1
            continue

        db.add(Transaction(
            account_id=account_id,
            tx_date=tx.tx_date,
            tx_desc=tx.tx_desc,
            tx_amount=tx.tx_amount,
            tx_type=tx.tx_type,
            tx_hash=tx_hash,
            balance=tx.balance,
            original_category=tx.original_category,
            is_categorised=False,
        ))
        inserted += 1

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        errors.append(f"Database error: {str(e)[:200]}")

    # Update last_upload_at for all accounts in this upload
    now = datetime.utcnow()
    for acc_id in account_map.values():
        acc_result = await db.execute(select(Account).where(Account.id == acc_id))
        acc = acc_result.scalar_one_or_none()
        if acc:
            acc.last_upload_at = now
    try:
        await db.commit()
    except Exception as e:
        logger.warning("Could not update last_upload_at: %s", e)
        await db.rollback()

    if inserted > 0:
        try:
            await apply_rules_to_transactions(db)
        except Exception as e:
            logger.warning("Could not apply rules after upload: %s", e)

    logger.info(
        "Upload complete: %s — %d inserted, %d duplicates, %d errors",
        result.bank_name, inserted, duplicates, len(errors),
    )

    return UploadResult(
        bank_name=result.bank_name,
        accounts_found=result.accounts_found,
        account_ids=list(dict.fromkeys(account_map.values())),
        total_rows=result.row_count,
        inserted=inserted,
        duplicates=duplicates,
        errors=errors,
    )


async def process_csv_upload(
    content: str,
    db: AsyncSession,
    account_id_override: int | None = None,
) -> UploadResult:
    """
    Process a bank or cash CSV upload end-to-end.

    Tries standard bank parsers (single-line header detection) first,
    then falls back to full-content parsers (e.g. Superhero Cash Statement).

    Raises:
        ValueError: If no parser matches the CSV format.
    """
    # Try standard bank parsers (Westpac, NAB, Macquarie)
    first_line = content.split("\n", 1)[0].strip()
    parser = detect_parser(first_line)

    # Fall back to full-content bank parsers (Superhero Cash Statement)
    if not parser:
        parser = detect_cash_parser(content)

    if not parser:
        raise ValueError(
            f"Unrecognised CSV format. Could not detect bank from header: '{first_line[:100]}'"
        )

    result: ParseResult = parser.parse(content)
    return await _process_parse_result(result, db, account_id_override)


@dataclass
class StockUploadResult:
    """Summary of a brokerage CSV upload operation."""

    platform_name: str
    account_id: int
    account_name: str
    account_number: str
    total_rows: int
    inserted: int
    duplicates: int
    errors: list[str]


async def process_stock_csv_upload(
    content: str,
    db: AsyncSession,
    account_id_override: int | None = None,
) -> StockUploadResult:
    """
    Process a Superhero (or other brokerage) CSV upload end-to-end.

    1. Detect and run the stock parser
    2. Create/find the investment account
    3. Insert StockTrade rows (skip duplicates)

    Raises:
        ValueError: If no stock parser matches the CSV format.
    """
    parser = detect_stock_parser(content)
    if not parser:
        raise ValueError(
            "Unrecognised stock CSV format. Could not detect brokerage platform."
        )

    result: StockParseResult = parser.parse(content)
    errors = list(result.errors)

    if not result.trades:
        return StockUploadResult(
            platform_name=result.platform_name,
            account_id=0,
            account_name=result.account_name,
            account_number=result.account_number,
            total_rows=result.row_count,
            inserted=0,
            duplicates=0,
            errors=errors or ["No trades found in file"],
        )

    # Create/find the investment account (or use the override if provided)
    if account_id_override:
        existing = await db.execute(select(Account).where(Account.id == account_id_override))
        acc = existing.scalar_one_or_none()
        if not acc:
            raise ValueError(f"Account ID {account_id_override} not found")
        account = acc
    else:
        account = await _get_or_create_account(
            db=db,
            account_number=result.account_number,
            bank_name=result.platform_name,
            account_type="investment",
            account_name=result.account_name or result.entity_name or result.account_number,
        )

    inserted = 0
    duplicates = 0

    for trade in result.trades:
        trade_hash = StockTrade.compute_hash(
            account_id=account.id,
            trade_date=trade.trade_date.strftime("%Y-%m-%d"),
            security_code=trade.security_code,
            trade_type=trade.trade_type,
            net_amount=trade.net_amount,
        )

        existing = await db.execute(
            select(StockTrade).where(StockTrade.trade_hash == trade_hash)
        )
        if existing.scalar_one_or_none():
            duplicates += 1
            continue

        db.add(StockTrade(
            account_id=account.id,
            trade_date=trade.trade_date,
            settlement_date=trade.settlement_date,
            security_name=trade.security_name,
            security_code=trade.security_code,
            trade_type=trade.trade_type,
            quantity=trade.quantity,
            avg_price=trade.avg_price,
            net_amount=trade.net_amount,
            brokerage=trade.brokerage,
            gst=trade.gst,
            tax=trade.tax,
            trade_hash=trade_hash,
        ))
        inserted += 1

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        errors.append(f"Database error: {str(e)[:200]}")

    # Update last_upload_at for the investment account
    try:
        account.last_upload_at = datetime.utcnow()
        await db.commit()
    except Exception as e:
        logger.warning("Could not update last_upload_at for stock account: %s", e)
        await db.rollback()

    logger.info(
        "Stock upload complete: %s — %d inserted, %d duplicates, %d errors",
        result.platform_name, inserted, duplicates, len(errors),
    )

    return StockUploadResult(
        platform_name=result.platform_name,
        account_id=account.id,
        account_name=account.account_name,
        account_number=result.account_number,
        total_rows=result.row_count,
        inserted=inserted,
        duplicates=duplicates,
        errors=errors,
    )


async def _get_or_create_account(
    db: AsyncSession,
    account_number: str,
    bank_name: str,
    account_type: str,
    account_name: str = "",
) -> Account:
    """Find an existing account or create a new one."""
    result = await db.execute(
        select(Account).where(Account.account_number == account_number)
    )
    account = result.scalar_one_or_none()

    if account:
        return account

    # Determine display name
    if account_name:
        # Use the bank-provided account name (e.g. "Boondall", "Basic Home Loan")
        display_name = account_name
    elif account_type == "credit_card":
        display_name = f"{bank_name} Credit Card ****{account_number}"
    else:
        display_name = f"{bank_name} Account {account_number}"

    account = Account(
        account_number=account_number,
        account_name=display_name,
        bank_name=bank_name,
        account_type=account_type,
    )
    db.add(account)
    await db.flush()  # Get the ID without committing
    return account
