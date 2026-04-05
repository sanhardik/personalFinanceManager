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

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Transaction
from app.parsers.base import ParseResult
from app.parsers.registry import detect_parser

logger = logging.getLogger(__name__)


@dataclass
class UploadResult:
    """Summary of a CSV upload operation."""

    bank_name: str
    accounts_found: list[str]
    total_rows: int
    inserted: int
    duplicates: int
    errors: list[str]


async def process_csv_upload(content: str, db: AsyncSession) -> UploadResult:
    """
    Process a CSV upload end-to-end.

    1. Auto-detect the bank from the CSV header
    2. Parse all transactions
    3. Create accounts if they don't exist
    4. Insert transactions, skipping duplicates

    Args:
        content: Raw CSV file content as a string.
        db: Async database session.

    Returns:
        UploadResult with counts and errors.

    Raises:
        ValueError: If no parser matches the CSV format.
    """
    # Step 1: Detect parser from header
    first_line = content.split("\n", 1)[0].strip()
    parser = detect_parser(first_line)
    if not parser:
        raise ValueError(
            f"Unrecognised CSV format. Could not detect bank from header: '{first_line[:100]}'"
        )

    # Step 2: Parse transactions
    result: ParseResult = parser.parse(content)
    errors = list(result.errors)

    if not result.transactions:
        return UploadResult(
            bank_name=result.bank_name,
            accounts_found=result.accounts_found,
            total_rows=result.row_count,
            inserted=0,
            duplicates=0,
            errors=errors or ["No transactions found in file"],
        )

    # Step 3: Create/find accounts
    account_map: dict[str, int] = {}  # account_number → account.id
    for tx in result.transactions:
        if tx.account_number not in account_map:
            account = await _get_or_create_account(
                db=db,
                account_number=tx.account_number,
                bank_name=result.bank_name,
                account_type=tx.account_type,
            )
            account_map[tx.account_number] = account.id

    # Step 4: Insert transactions (skip duplicates)
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

        # Check if already exists
        existing = await db.execute(
            select(Transaction).where(Transaction.tx_hash == tx_hash)
        )
        if existing.scalar_one_or_none():
            duplicates += 1
            continue

        transaction = Transaction(
            account_id=account_id,
            tx_date=tx.tx_date,
            tx_desc=tx.tx_desc,
            tx_amount=tx.tx_amount,
            tx_type=tx.tx_type,
            tx_hash=tx_hash,
            balance=tx.balance,
            original_category=tx.original_category,
            is_categorised=False,
        )
        db.add(transaction)
        inserted += 1

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        errors.append(f"Database error: {str(e)[:200]}")

    logger.info(
        "Upload complete: %s — %d inserted, %d duplicates, %d errors",
        result.bank_name, inserted, duplicates, len(errors),
    )

    return UploadResult(
        bank_name=result.bank_name,
        accounts_found=result.accounts_found,
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
) -> Account:
    """Find an existing account or create a new one."""
    result = await db.execute(
        select(Account).where(Account.account_number == account_number)
    )
    account = result.scalar_one_or_none()

    if account:
        return account

    # Auto-generate a name
    if account_type == "credit_card":
        name = f"{bank_name} Credit Card ****{account_number}"
    else:
        name = f"{bank_name} Account {account_number}"

    account = Account(
        account_number=account_number,
        account_name=name,
        bank_name=bank_name,
        account_type=account_type,
    )
    db.add(account)
    await db.flush()  # Get the ID without committing
    return account
