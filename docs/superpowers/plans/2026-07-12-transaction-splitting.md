# Transaction Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a single bank transaction to be split into N child transactions, each with its own amount, description, category, and optional loan link — the primary use case being a lump-sum loan repayment covering multiple loans.

**Architecture:** Two new boolean/FK columns on `transactions` mark parent/child relationships. Two new endpoints handle split creation and removal. All dashboard and list queries gain a `WHERE NOT is_split_parent` clause. The frontend adds a scissors button per row opening a dynamic split dialog.

**Tech Stack:** FastAPI + SQLAlchemy async + MariaDB; React 19 + Vite + shadcn/ui; pytest on MariaDB port 3307.

## Global Constraints

- Startup migrations use the `information_schema.COLUMNS` pattern already in `backend/app/main.py` — no Alembic.
- Test client uses `_ApiClient` wrapper that prepends `/api` automatically — all test URLs omit `/api`.
- Run tests: `cd /Users/Hardik.Sanghavi/ClaudeCoWork/FinancePortfolioManager/finance-app && ./run.sh test`
- Baseline: 296 passed, 5 skipped.
- Frontend build check: `cd /Users/Hardik.Sanghavi/ClaudeCoWork/FinancePortfolioManager/finance-app/frontend && npm run build 2>&1 | tail -5`
- Do not break existing PATCH /transactions/{id}, GET /transactions, or dashboard endpoints.
- `is_split_parent` and `parent_transaction_id` must not be settable via the existing PATCH endpoint.

## File Map

| File | Change |
|------|--------|
| `backend/app/models.py` | Add `is_split_parent`, `parent_transaction_id` to `Transaction`; add `splits` relationship |
| `backend/app/schemas.py` | Add `SplitItem`, `SplitRequest`; extend `TransactionResponse` with split fields |
| `backend/app/main.py` | Startup migration for 2 new columns |
| `backend/app/routers/transactions.py` | Add `POST /{id}/split`, `DELETE /{id}/split`; add `NOT is_split_parent` to list query |
| `backend/app/routers/dashboard.py` | Add `NOT is_split_parent` to all 3 query functions via `_base_filters` |
| `backend/tests/test_split.py` | New test file — 11 tests |
| `frontend/src/api/transactions.js` | Add `splitTransaction`, `unsplitTransaction` |
| `frontend/src/pages/Transactions.jsx` | Add scissors button, `SplitDialog` component, expandable parent rows |

---

### Task 1: Backend — Model + Schema + Migration

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Produces: `Transaction.is_split_parent: bool`, `Transaction.parent_transaction_id: int | None`, `Transaction.splits` relationship
- Produces: `TransactionResponse.is_split_parent: bool`, `TransactionResponse.parent_transaction_id: int | None`, `TransactionResponse.splits: list | None`
- Produces: `SplitItem`, `SplitRequest` Pydantic models

- [ ] **Step 1: Add columns to Transaction model**

In `backend/app/models.py`, inside the `Transaction` class after `lending_tx_type` (line ~236), add:

```python
    is_split_parent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="0")
    parent_transaction_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("transactions.id", ondelete="CASCADE"), nullable=True
    )
```

After the existing relationships block (after `lending_loan` relationship), add:

```python
    splits: Mapped[list["Transaction"]] = relationship(
        "Transaction",
        foreign_keys="Transaction.parent_transaction_id",
        back_populates="parent_tx",
        cascade="all, delete-orphan",
    )
    parent_tx: Mapped["Transaction | None"] = relationship(
        "Transaction",
        foreign_keys="Transaction.parent_transaction_id",
        back_populates="splits",
        remote_side="Transaction.id",
    )
```

- [ ] **Step 2: Add Pydantic schemas**

In `backend/app/schemas.py`, after the `TransactionResponse` class (after line ~237), add:

```python
class SplitItem(BaseModel):
    description: str = Field(..., min_length=1, max_length=500)
    amount: float = Field(..., gt=0)
    category_id: int | None = None
    lending_loan_id: int | None = None
    lending_tx_type: str | None = Field(default=None, pattern="^(disbursement|repayment)$")

class SplitRequest(BaseModel):
    splits: list[SplitItem] = Field(..., min_length=2)
```

Extend `TransactionResponse` — add these fields after `lending_loan_name`:

```python
    is_split_parent: bool = False
    parent_transaction_id: int | None = None
    splits: list["TransactionResponse"] | None = None
```

- [ ] **Step 3: Add startup migration**

In `backend/app/main.py`, after the lending_loans migration block (after the block ending with `logger.warning("Migration: lending_loans new columns...")`), add:

```python
        # Schema migrations — transaction split columns
        try:
            async with engine.begin() as conn:
                for col_name, col_def in [
                    ("is_split_parent", "BOOLEAN NOT NULL DEFAULT FALSE"),
                    ("parent_transaction_id", "INT NULL"),
                ]:
                    exists = await conn.execute(text(
                        "SELECT COUNT(*) FROM information_schema.COLUMNS "
                        "WHERE TABLE_SCHEMA = DATABASE() "
                        "AND TABLE_NAME = 'transactions' AND COLUMN_NAME = :col"
                    ), {"col": col_name})
                    if exists.scalar() == 0:
                        await conn.execute(text(
                            f"ALTER TABLE transactions ADD COLUMN {col_name} {col_def}"
                        ))
                        logger.info("Migration: added %s to transactions", col_name)
                # Add FK constraint on parent_transaction_id if not present
                fk_exists = await conn.execute(text(
                    "SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE "
                    "WHERE TABLE_SCHEMA = DATABASE() "
                    "AND TABLE_NAME = 'transactions' "
                    "AND COLUMN_NAME = 'parent_transaction_id' "
                    "AND REFERENCED_TABLE_NAME = 'transactions'"
                ))
                if fk_exists.scalar() == 0:
                    await conn.execute(text(
                        "ALTER TABLE transactions ADD CONSTRAINT fk_tx_parent "
                        "FOREIGN KEY (parent_transaction_id) REFERENCES transactions(id) ON DELETE CASCADE"
                    ))
                    logger.info("Migration: added FK fk_tx_parent on transactions.parent_transaction_id")
        except Exception as e:
            logger.warning("Migration: split columns failed (non-fatal): %s", e)
```

- [ ] **Step 4: Restart backend, verify migration**

```bash
# Restart backend (or it restarts automatically)
curl -s http://localhost:8000/api/health
```

Then verify columns exist:
```bash
mysql -u finance_user -pfinance_pass finance_app -e \
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME='transactions' AND COLUMN_NAME IN ('is_split_parent','parent_transaction_id');"
```

Expected: 2 rows returned.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py backend/app/main.py
git commit -m "feat: add is_split_parent + parent_transaction_id to transactions model and schema"
```

---

### Task 2: Backend — Split Endpoints + Dashboard Filter

**Files:**
- Modify: `backend/app/routers/transactions.py`
- Modify: `backend/app/routers/dashboard.py`

**Interfaces:**
- Consumes: `SplitItem`, `SplitRequest` from Task 1; `Transaction.is_split_parent`, `Transaction.splits`
- Produces: `POST /transactions/{id}/split` → `TransactionResponse` with nested `splits`
- Produces: `DELETE /transactions/{id}/split` → `TransactionResponse`
- Produces: `GET /transactions` excludes `is_split_parent=True` rows
- Produces: all dashboard queries exclude `is_split_parent=True` rows

- [ ] **Step 1: Update `_tx_to_response` to include split fields**

In `backend/app/routers/transactions.py`, update the `_tx_to_response` function to include split fields:

```python
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
    # Nested splits — only if eagerly loaded and non-empty
    if tx.is_split_parent and hasattr(tx, "splits") and tx.splits:
        data["splits"] = [_tx_to_response(s) for s in tx.splits]
    else:
        data["splits"] = None
    return data
```

- [ ] **Step 2: Add `NOT is_split_parent` to the list query**

In `backend/app/routers/transactions.py`, find the `list_transactions` endpoint. The `stmt` starts with:

```python
    stmt = select(Transaction).options(
        selectinload(Transaction.category),
        selectinload(Transaction.transfer_account),
        selectinload(Transaction.lending_loan),
    )
    count_stmt = select(func.count(Transaction.id))
```

Add `is_split_parent=False` filter to both stmts immediately after their definitions:

```python
    stmt = stmt.where(Transaction.is_split_parent == False)
    count_stmt = count_stmt.where(Transaction.is_split_parent == False)
```

- [ ] **Step 3: Add split endpoints**

In `backend/app/routers/transactions.py`, add these imports at the top if not present:

```python
import hashlib
```

Add the following two endpoints after the `patch_transaction` endpoint. Also add the import at the top:

```python
from app.schemas import SplitItem, SplitRequest
```

Endpoints:

```python
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
```

- [ ] **Step 4: Add `NOT is_split_parent` to dashboard queries**

In `backend/app/routers/dashboard.py`, the `_base_filters` function returns a list of WHERE clauses used by all three endpoints. Add the split-parent exclusion:

```python
def _base_filters(date_from: date, date_to: date):
    """Common WHERE clauses: date range + exclude transfer categories + exclude split parents."""
    return [
        Transaction.tx_date.between(date_from, date_to),
        Transaction.is_split_parent == False,
        or_(
            Transaction.category_id.is_(None),
            Transaction.category_id.notin_(_transfer_cat_ids()),
        ),
    ]
```

The `by-category` endpoint has its own inline `.where(...)` — add `Transaction.is_split_parent == False` there too:

```python
        .where(
            Transaction.tx_date.between(date_from, date_to),
            Transaction.tx_type == tx_type,
            Transaction.is_split_parent == False,
            or_(
                Transaction.category_id.is_(None),
                Transaction.category_id.notin_(_transfer_cat_ids()),
            ),
        )
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/Hardik.Sanghavi/ClaudeCoWork/FinancePortfolioManager/finance-app && ./run.sh test
```

Expected: 296 passed, 5 skipped (no regressions yet — new endpoints tested in Task 3).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/transactions.py backend/app/routers/dashboard.py
git commit -m "feat: POST/DELETE /transactions/{id}/split endpoints; exclude split parents from list + dashboard"
```

---

### Task 3: Backend — Tests

**Files:**
- Create: `backend/tests/test_split.py`

**Interfaces:**
- Consumes: `POST /transactions/{id}/split`, `DELETE /transactions/{id}/split` from Task 2
- Consumes: `GET /transactions` (split parents excluded), `GET /dashboard/summary` (split parents excluded)

- [ ] **Step 1: Create test file with all 11 tests**

Create `backend/tests/test_split.py`:

```python
"""Tests for transaction splitting (POST/DELETE /transactions/{id}/split)."""
import pytest
from httpx import AsyncClient


async def _make_account(client):
    r = await client.post("/accounts", json={
        "account_name": "Test Account", "account_number": "123456789",
        "bank_name": "Westpac", "account_type": "bank",
    })
    assert r.status_code == 201
    return r.json()["id"]


async def _make_tx(client, account_id, amount=1000.0, tx_type="Income", desc="Combined repayment"):
    from datetime import date
    r = await client.post("/transactions/test-insert", json={
        "account_id": account_id, "tx_date": "2025-06-01T00:00:00",
        "tx_desc": desc, "tx_amount": amount, "tx_type": tx_type,
        "tx_hash": f"hash-{desc}-{amount}",
    })
    # Use the upload endpoint or direct DB insert via conftest fixture
    # Actually use the db_session fixture directly
    return r


# Helper using db_session to insert a transaction directly
async def _insert_tx(db_session, account_id, amount=1000.0, tx_type="Income", desc="Combined repayment"):
    from app.models import Transaction
    import hashlib
    h = hashlib.sha256(f"{account_id}|2025-06-01|{desc}|{amount}".encode()).hexdigest()
    tx = Transaction(
        account_id=account_id, tx_date="2025-06-01",
        tx_desc=desc, tx_amount=amount, tx_type=tx_type, tx_hash=h,
        is_categorised=False,
    )
    db_session.add(tx)
    await db_session.commit()
    await db_session.refresh(tx)
    return tx


async def _make_account_db(db_session):
    from app.models import Account
    acc = Account(account_name="Split Test", account_number="999888777",
                  bank_name="NAB", account_type="bank", is_active=True)
    db_session.add(acc)
    await db_session.commit()
    await db_session.refresh(acc)
    return acc.id


@pytest.mark.anyio
async def test_split_creates_children(client: AsyncClient, db_session):
    acc_id = await _make_account_db(db_session)
    tx = await _insert_tx(db_session, acc_id, amount=1000.0)

    r = await client.post(f"/transactions/{tx.id}/split", json={"splits": [
        {"description": "Loan A repayment", "amount": 500.0, "lending_loan_id": None},
        {"description": "Loan B repayment", "amount": 300.0, "lending_loan_id": None},
        {"description": "Loan C repayment", "amount": 200.0, "lending_loan_id": None},
    ]})
    assert r.status_code == 200
    data = r.json()
    assert data["is_split_parent"] is True
    assert len(data["splits"]) == 3
    amounts = sorted(s["amount"] for s in data["splits"])
    assert amounts == [200.0, 300.0, 500.0]


@pytest.mark.anyio
async def test_split_sets_descriptions(client: AsyncClient, db_session):
    acc_id = await _make_account_db(db_session)
    tx = await _insert_tx(db_session, acc_id, amount=600.0, desc="Bulk payment")

    r = await client.post(f"/transactions/{tx.id}/split", json={"splits": [
        {"description": "Alice share", "amount": 400.0},
        {"description": "Bob share", "amount": 200.0},
    ]})
    assert r.status_code == 200
    descs = {s["tx_desc"] for s in r.json()["splits"]}
    assert descs == {"Alice share", "Bob share"}


@pytest.mark.anyio
async def test_split_parent_excluded_from_list(client: AsyncClient, db_session):
    acc_id = await _make_account_db(db_session)
    tx = await _insert_tx(db_session, acc_id, amount=800.0)

    await client.post(f"/transactions/{tx.id}/split", json={"splits": [
        {"description": "Part 1", "amount": 500.0},
        {"description": "Part 2", "amount": 300.0},
    ]})

    r = await client.get("/transactions", params={"account_id": acc_id})
    ids = [t["id"] for t in r.json()["items"]]
    assert tx.id not in ids  # parent excluded
    assert len(ids) == 2     # children present


@pytest.mark.anyio
async def test_split_parent_excluded_from_dashboard(client: AsyncClient, db_session):
    acc_id = await _make_account_db(db_session)
    tx = await _insert_tx(db_session, acc_id, amount=1000.0, tx_type="Income")

    # Before split: $1000 income
    r = await client.get("/dashboard/summary", params={"date_from": "2025-01-01", "date_to": "2025-12-31"})
    income_before = r.json()["total_income"]

    await client.post(f"/transactions/{tx.id}/split", json={"splits": [
        {"description": "Child A", "amount": 600.0},
        {"description": "Child B", "amount": 400.0},
    ]})

    r = await client.get("/dashboard/summary", params={"date_from": "2025-01-01", "date_to": "2025-12-31"})
    income_after = r.json()["total_income"]
    # Total income unchanged (parent excluded, children added — net same)
    assert abs(income_after - income_before) < 0.02


@pytest.mark.anyio
async def test_split_rejects_wrong_sum(client: AsyncClient, db_session):
    acc_id = await _make_account_db(db_session)
    tx = await _insert_tx(db_session, acc_id, amount=1000.0)

    r = await client.post(f"/transactions/{tx.id}/split", json={"splits": [
        {"description": "Part 1", "amount": 600.0},
        {"description": "Part 2", "amount": 600.0},
    ]})
    assert r.status_code == 422
    assert "1200" in r.json()["detail"] or "sum" in r.json()["detail"].lower()


@pytest.mark.anyio
async def test_split_rejects_single_item(client: AsyncClient, db_session):
    acc_id = await _make_account_db(db_session)
    tx = await _insert_tx(db_session, acc_id, amount=500.0)

    r = await client.post(f"/transactions/{tx.id}/split", json={"splits": [
        {"description": "Only one", "amount": 500.0},
    ]})
    assert r.status_code == 422


@pytest.mark.anyio
async def test_split_rejects_child_transaction(client: AsyncClient, db_session):
    acc_id = await _make_account_db(db_session)
    tx = await _insert_tx(db_session, acc_id, amount=1000.0)

    r = await client.post(f"/transactions/{tx.id}/split", json={"splits": [
        {"description": "A", "amount": 600.0},
        {"description": "B", "amount": 400.0},
    ]})
    child_id = r.json()["splits"][0]["id"]

    r2 = await client.post(f"/transactions/{child_id}/split", json={"splits": [
        {"description": "X", "amount": 400.0},
        {"description": "Y", "amount": 200.0},
    ]})
    assert r2.status_code == 400


@pytest.mark.anyio
async def test_unsplit_removes_children(client: AsyncClient, db_session):
    acc_id = await _make_account_db(db_session)
    tx = await _insert_tx(db_session, acc_id, amount=700.0)

    await client.post(f"/transactions/{tx.id}/split", json={"splits": [
        {"description": "X", "amount": 400.0},
        {"description": "Y", "amount": 300.0},
    ]})

    r = await client.delete(f"/transactions/{tx.id}/split")
    assert r.status_code == 200
    assert r.json()["is_split_parent"] is False

    r2 = await client.get("/transactions", params={"account_id": acc_id})
    ids = [t["id"] for t in r2.json()["items"]]
    assert tx.id in ids
    assert len(ids) == 1


@pytest.mark.anyio
async def test_unsplit_rejects_non_parent(client: AsyncClient, db_session):
    acc_id = await _make_account_db(db_session)
    tx = await _insert_tx(db_session, acc_id, amount=500.0)

    r = await client.delete(f"/transactions/{tx.id}/split")
    assert r.status_code == 400


@pytest.mark.anyio
async def test_resplit_replaces_children(client: AsyncClient, db_session):
    acc_id = await _make_account_db(db_session)
    tx = await _insert_tx(db_session, acc_id, amount=900.0)

    await client.post(f"/transactions/{tx.id}/split", json={"splits": [
        {"description": "First A", "amount": 500.0},
        {"description": "First B", "amount": 400.0},
    ]})

    r = await client.post(f"/transactions/{tx.id}/split", json={"splits": [
        {"description": "New A", "amount": 300.0},
        {"description": "New B", "amount": 300.0},
        {"description": "New C", "amount": 300.0},
    ]})
    assert r.status_code == 200
    assert len(r.json()["splits"]) == 3
    descs = {s["tx_desc"] for s in r.json()["splits"]}
    assert "First A" not in descs


@pytest.mark.anyio
async def test_split_404_on_unknown_tx(client: AsyncClient):
    r = await client.post("/transactions/999999/split", json={"splits": [
        {"description": "A", "amount": 100.0},
        {"description": "B", "amount": 100.0},
    ]})
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/Hardik.Sanghavi/ClaudeCoWork/FinancePortfolioManager/finance-app && ./run.sh test
```

Expected: 307 passed, 5 skipped (296 baseline + 11 new).

- [ ] **Step 3: Fix any failures**

The `_insert_tx` helper uses `db_session` to insert directly — if `db_session` fixture isn't available in this file, import from conftest. Check `backend/tests/conftest.py` for the `db_session` fixture name and adapt accordingly.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_split.py
git commit -m "test: transaction splitting — 11 tests covering split, unsplit, validation, dashboard exclusion"
```

---

### Task 4: Frontend — Split Dialog + Row Changes

**Files:**
- Modify: `frontend/src/api/transactions.js`
- Modify: `frontend/src/pages/Transactions.jsx`

**Interfaces:**
- Consumes: `POST /transactions/{id}/split`, `DELETE /transactions/{id}/split` from Task 2
- Consumes: `TransactionResponse.is_split_parent`, `TransactionResponse.splits` from Task 1
- Produces: Scissors button on each non-child transaction row; `SplitDialog` component; expandable parent rows

- [ ] **Step 1: Add API functions**

In `frontend/src/api/transactions.js`, add after the existing exports:

```javascript
export const splitTransaction = (id, splits) =>
  api.post(`/transactions/${id}/split`, { splits }).then(r => r.data);
export const unsplitTransaction = (id) =>
  api.delete(`/transactions/${id}/split`).then(r => r.data);
```

- [ ] **Step 2: Add `SplitDialog` component to Transactions.jsx**

Add these imports at the top of `frontend/src/pages/Transactions.jsx`:

```javascript
import { Scissors, Trash2 } from 'lucide-react';
import { splitTransaction, unsplitTransaction } from '../api/transactions';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
```

Add the `SplitDialog` component definition before the `export default function Transactions()` line:

```javascript
function SplitDialog({ tx, categories, loans, onClose, onSaved }) {
  const [rows, setRows] = useState(() => {
    if (tx.splits && tx.splits.length >= 2) {
      return tx.splits.map(s => ({
        description: s.tx_desc,
        amount: String(s.tx_amount),
        category_id: s.category_id ? String(s.category_id) : '',
        lending_loan_id: s.lending_loan_id ? String(s.lending_loan_id) : '',
        lending_tx_type: s.lending_tx_type || '',
      }));
    }
    return [
      { description: tx.tx_desc, amount: '', category_id: '', lending_loan_id: '', lending_tx_type: '' },
      { description: tx.tx_desc, amount: '', category_id: '', lending_loan_id: '', lending_tx_type: '' },
    ];
  });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const setRow = (i, key, val) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [key]: val } : r));

  const addRow = () =>
    setRows(prev => [...prev, { description: tx.tx_desc, amount: '', category_id: '', lending_loan_id: '', lending_tx_type: '' }]);

  const removeRow = (i) =>
    setRows(prev => prev.filter((_, idx) => idx !== i));

  const total = rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const remainder = Math.round((tx.tx_amount - total) * 100) / 100;
  const balanced = Math.abs(remainder) <= 0.01;

  const handleSave = async () => {
    setSaving(true);
    try {
      const splits = rows.map(r => ({
        description: r.description.trim() || tx.tx_desc,
        amount: parseFloat(r.amount),
        category_id: r.category_id ? parseInt(r.category_id) : null,
        lending_loan_id: r.lending_loan_id ? parseInt(r.lending_loan_id) : null,
        lending_tx_type: r.lending_tx_type || null,
      }));
      const updated = await splitTransaction(tx.id, splits);
      onSaved(updated);
      onClose();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to save splits');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove split and restore original transaction?')) return;
    setRemoving(true);
    try {
      const updated = await unsplitTransaction(tx.id);
      onSaved(updated);
      onClose();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to remove split');
    } finally {
      setRemoving(false);
    }
  };

  const nativeSelectCls = 'flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Split Transaction</DialogTitle>
        </DialogHeader>

        {/* Header: original transaction */}
        <div className="bg-slate-50 rounded-lg px-4 py-3 text-sm mb-4">
          <p className="text-slate-500 text-xs mb-0.5">{new Date(tx.tx_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
          <p className="font-medium text-slate-800">{tx.tx_desc}</p>
          <p className="text-lg font-bold text-slate-900 mt-0.5">
            {tx.tx_type === 'Income' ? '+' : '-'}${tx.tx_amount.toFixed(2)}
          </p>
        </div>

        {/* Split rows */}
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-4">
                <input
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Description"
                  value={row.description}
                  onChange={e => setRow(i, 'description', e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <input
                  type="number" min="0.01" step="0.01"
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Amount"
                  value={row.amount}
                  onChange={e => setRow(i, 'amount', e.target.value)}
                />
              </div>
              <div className="col-span-3">
                <select className={nativeSelectCls} value={row.category_id}
                  onChange={e => setRow(i, 'category_id', e.target.value)}>
                  <option value="">— category</option>
                  {categories.filter(c => c.category_type === tx.tx_type).sort((a,b) => a.name.localeCompare(b.name)).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <select className={nativeSelectCls} value={row.lending_loan_id}
                  onChange={e => {
                    setRow(i, 'lending_loan_id', e.target.value);
                    if (e.target.value) {
                      setRow(i, 'lending_tx_type', tx.tx_type === 'Expense' ? 'disbursement' : 'repayment');
                    } else {
                      setRow(i, 'lending_tx_type', '');
                    }
                  }}>
                  <option value="">— loan</option>
                  {loans.filter(l => l.status === 'active').map(l => (
                    <option key={l.id} value={l.id}>{l.loan_name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-1 flex justify-center">
                <button
                  type="button"
                  disabled={rows.length <= 2}
                  onClick={() => removeRow(i)}
                  className="text-slate-300 hover:text-red-500 disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add row */}
        <button type="button" onClick={addRow}
          className="text-xs text-blue-600 hover:text-blue-800 mt-2">
          + Add split
        </button>

        {/* Remainder */}
        <div className={`text-sm font-medium mt-3 ${balanced ? 'text-green-700' : 'text-red-600'}`}>
          {balanced
            ? '✓ Balanced'
            : `${remainder > 0 ? `$${remainder.toFixed(2)} remaining` : `$${Math.abs(remainder).toFixed(2)} over`}`
          }
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-3 border-t border-slate-100 mt-3">
          <div>
            {tx.is_split_parent && (
              <button type="button" onClick={handleRemove} disabled={removing}
                className="text-xs text-red-500 hover:text-red-700">
                {removing ? 'Removing…' : 'Remove split'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-md hover:bg-slate-50">
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={!balanced || saving}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Saving…' : 'Save splits'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Add state and handler to `Transactions` component**

Inside `export default function Transactions()`, after the existing state declarations, add:

```javascript
  const [splitTx, setSplitTx] = useState(null); // tx being split
  const [expandedSplits, setExpandedSplits] = useState(new Set());
```

Add handler:

```javascript
  const handleSplitSaved = useCallback((updated) => {
    setTransactions(prev => prev.map(t => t.id === updated.id ? updated : t));
    refreshStats();
  }, [refreshStats]);

  const toggleSplitExpand = (id) => setExpandedSplits(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
```

- [ ] **Step 4: Add scissors button and split badge to transaction rows**

In the `TableRow` for each transaction (around line 567), the row currently has action buttons. Find the category display cell and the row's action area. Add the scissors button to the row — place it just before or after the category cell area.

In the `TableRow`, after the balance cell (`TableCell` with `tx.balance`), modify the category `TableCell` to also include a scissors icon button. Specifically, wrap the existing category cell with a flex container that adds the scissors button on the left:

In the non-editing state of the category cell (the `<button onClick=...>` around line 643), wrap the whole `TableCell` content with:

```jsx
<TableCell>
  <div className="flex items-center gap-2">
    {/* Scissors button — not shown for children */}
    {!tx.parent_transaction_id && (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setSplitTx(tx); }}
        className="text-slate-300 hover:text-blue-500 flex-shrink-0"
        title="Split transaction"
      >
        <Scissors size={13} />
      </button>
    )}
    {/* Existing category edit UI */}
    {editingCategoryTxId === tx.id ? (
      /* ... existing editing JSX unchanged ... */
    ) : (
      /* ... existing non-editing JSX ... */
    )}
  </div>
</TableCell>
```

Also add the split badge to parent rows. In the non-editing display, after the existing category name span, add:

```jsx
{tx.is_split_parent && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); toggleSplitExpand(tx.id); }}
    className="flex items-center gap-0.5 text-xs text-indigo-500 ml-1 hover:text-indigo-700"
    title="Show splits"
  >
    <Scissors size={10} />
    <span>{expandedSplits.has(tx.id) ? '▲' : '▼'}</span>
  </button>
)}
```

- [ ] **Step 5: Add expandable child rows beneath split parents**

After the closing `</TableRow>` of each transaction (inside the `transactions.map`), add:

```jsx
{tx.is_split_parent && expandedSplits.has(tx.id) && tx.splits && tx.splits.map(child => (
  <TableRow key={`split-${child.id}`} className="bg-indigo-50/40 border-indigo-100">
    <TableCell className="text-slate-400 whitespace-nowrap pl-8 text-xs">↳</TableCell>
    <TableCell className="text-slate-600 max-w-xs truncate text-xs pl-2" title={child.tx_desc}>{child.tx_desc}</TableCell>
    <TableCell className="hidden md:table-cell text-slate-400 text-xs"></TableCell>
    <TableCell className={cn('text-right font-medium whitespace-nowrap text-xs', child.tx_type === 'Income' ? 'text-green-600' : 'text-slate-700')}>
      {child.tx_type === 'Income' ? '+' : '-'}{formatAmount(child.tx_amount)}
    </TableCell>
    <TableCell className="hidden lg:table-cell"></TableCell>
    <TableCell>
      <div className="flex items-center gap-1.5">
        {child.category_name && (
          <>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getCategoryColour(child.category_id) }} />
            <span className="text-xs text-slate-600">{child.category_name}</span>
          </>
        )}
        {child.lending_loan_name && (
          <span className="text-xs text-indigo-600 ml-0.5">→ {child.lending_loan_name}</span>
        )}
      </div>
    </TableCell>
  </TableRow>
))}
```

- [ ] **Step 6: Render `SplitDialog` at the bottom of the component**

Just before the closing `</div>` of the `Transactions` component's return, add:

```jsx
{splitTx && (
  <SplitDialog
    tx={splitTx}
    categories={categories}
    loans={loans}
    onClose={() => setSplitTx(null)}
    onSaved={handleSplitSaved}
  />
)}
```

- [ ] **Step 7: Build check**

```bash
cd /Users/Hardik.Sanghavi/ClaudeCoWork/FinancePortfolioManager/finance-app/frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs` with no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/transactions.js frontend/src/pages/Transactions.jsx
git commit -m "feat: transaction split dialog — scissors button, dynamic rows, live balance, expandable children"
```

---

### Task 5: Deploy to RPi

**Files:** None — git push + remote commands.

- [ ] **Step 1: Push to remote**

```bash
git push origin feat/shadcn-ui-migration
```

- [ ] **Step 2: Pull and restart on RPi**

```bash
ssh hardik@10.0.0.73 "cd ~/FinancePortfolioManager && git pull origin feat/shadcn-ui-migration"
ssh hardik@10.0.0.73 "cd ~/FinancePortfolioManager/frontend && npm run build 2>&1 | tail -3"
```

Restart backend (kill and relaunch — migrations run on startup):
```bash
ssh hardik@10.0.0.73 "pkill -f 'uvicorn app.main:app' ; sleep 2 ; cd ~/FinancePortfolioManager/backend && nohup venv/bin/python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 > /tmp/backend.log 2>&1 &"
sleep 5
ssh hardik@10.0.0.73 "curl -s http://localhost:8000/api/health"
```

- [ ] **Step 3: Verify migration ran**

```bash
ssh hardik@10.0.0.73 "mysql -u finance_user -pfinance_pass finance_app -e \"SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME='transactions' AND COLUMN_NAME IN ('is_split_parent','parent_transaction_id');\""
```

Expected: 2 rows.

---

## Self-Review

**Spec coverage:**
- ✅ `is_split_parent` + `parent_transaction_id` columns — Task 1
- ✅ SHA256 child hash `"{parent_id}|{i}|{amount}"` — Task 2
- ✅ `POST /transactions/{id}/split` with validation — Task 2
- ✅ `DELETE /transactions/{id}/split` — Task 2
- ✅ Re-split replaces children — Task 2
- ✅ `GET /transactions` excludes split parents — Task 2
- ✅ Dashboard all 3 endpoints exclude split parents — Task 2
- ✅ 11 backend tests — Task 3
- ✅ `splitTransaction` + `unsplitTransaction` API functions — Task 4
- ✅ Scissors button on non-child rows — Task 4
- ✅ Split dialog: dynamic rows, description, amount, category, loan — Task 4
- ✅ Live remainder / balance display — Task 4
- ✅ Remove split button (only when already split) — Task 4
- ✅ Expandable parent rows with children — Task 4
- ✅ RPi deployment — Task 5

**Type consistency:** `SplitRequest.splits` → list of `SplitItem`; `splitTransaction(id, splits)` passes array; backend receives `body.splits`. `TransactionResponse.splits: list[TransactionResponse] | None`. Consistent.

**No placeholders:** All steps contain real code.
