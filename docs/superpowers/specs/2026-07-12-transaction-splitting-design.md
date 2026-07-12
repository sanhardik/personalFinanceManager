# Transaction Splitting — Design Spec
Date: 2026-07-12

## Overview
Allow a single bank transaction to be split into N child transactions, each with its own amount, description, category, and optional loan link. The primary use case is a lump-sum repayment covering multiple outstanding loans given out by the user.

---

## 1. Data Model

Two new nullable/defaulted columns on `transactions`:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `is_split_parent` | `BOOLEAN NOT NULL` | `FALSE` | Marks the original transaction as a split container |
| `parent_transaction_id` | `INT NULL FK → transactions.id ON DELETE CASCADE` | `NULL` | Set on each child split row |

**Parent row:** `is_split_parent = TRUE`, `parent_transaction_id = NULL`. Excluded from all totals via `WHERE NOT is_split_parent`. Shown in the transaction list with a split badge and expand toggle.

**Child rows:** `is_split_parent = FALSE`, `parent_transaction_id = <parent id>`. Full participants in all existing infrastructure — PATCH endpoint, loan linking, dashboard totals, amortisation schedule matching.

**tx_hash for children:** `SHA256(parent_id | index | amount)` — guarantees uniqueness without colliding with CSV-imported hashes.

**Unsplitting:** Deleting all children (CASCADE) + resetting `is_split_parent = FALSE` on parent returns it to a normal transaction.

**Startup migration:** `information_schema.COLUMNS` pattern in `main.py` — same as all existing column migrations.

---

## 2. Backend

### New Endpoints

**`POST /api/transactions/{id}/split`**

Request body — array of split items:
```json
[
  { "description": "John repayment", "amount": 500.00, "category_id": 12, "lending_loan_id": 3, "lending_tx_type": "repayment" },
  { "description": "Sarah repayment", "amount": 300.00, "category_id": 12, "lending_loan_id": 5, "lending_tx_type": "repayment" },
  { "description": "Tom repayment",   "amount": 200.00, "category_id": 12 }
]
```

Validation (422 if any fail):
- At least 2 splits
- Each `amount > 0`
- Sum of amounts within ±$0.01 of parent `tx_amount`
- Target transaction must not itself be a child (`parent_transaction_id IS NOT NULL` → 400)

Behaviour:
1. Delete any existing children (re-split replaces previous children)
2. Set `is_split_parent = TRUE` on parent
3. Create child rows inheriting `account_id`, `tx_date`, `tx_type` from parent; `tx_hash` = `SHA256("{parent_id}|{i}|{amount}")`
4. Return parent row with `splits: [...]` nested array

**`DELETE /api/transactions/{id}/split`**

- Deletes all child rows (CASCADE handles FK cleanup)
- Resets parent `is_split_parent = FALSE`
- Returns updated parent row
- 400 if transaction is not a split parent

### Existing Query Changes

| Endpoint | Change |
|----------|--------|
| `GET /transactions` | Add `WHERE NOT is_split_parent` to exclude parents from top-level list. Parent rows with children returned with a `splits` array when `include_splits=true` query param passed (default false). |
| `GET /dashboard/summary` | Add `WHERE NOT is_split_parent` |
| `GET /dashboard/monthly` | Add `WHERE NOT is_split_parent` |
| `GET /dashboard/by-category` | Add `WHERE NOT is_split_parent` |

### Schema Changes

`TransactionResponse` gains:
- `is_split_parent: bool = False`
- `parent_transaction_id: int | None = None`
- `splits: list[TransactionResponse] | None = None` — populated only when `include_splits=true`

New Pydantic models:
- `SplitItem` — `description: str`, `amount: float (gt=0)`, `category_id: int | None`, `lending_loan_id: int | None`, `lending_tx_type: str | None`
- `SplitRequest` — `list[SplitItem]` with min length 2

---

## 3. Frontend

### Transaction Row
- Scissors icon button added to action area of each top-level transaction row
- Not shown on child rows (`parent_transaction_id` is set)
- Split parent rows display a `⑂ Split` badge and a chevron expand toggle
- Expanding shows child rows indented beneath, each with their own colour dot, category, loan badge, and amount

### Split Dialog
Opens on scissors button click. Contains:

**Header (read-only):** Original transaction date, description, total amount.

**Split rows (dynamic):**
- Description input (pre-filled from parent `tx_desc`)
- Amount input (numeric)
- Category selector (same grouped `<select>` as existing inline editor)
- Loan selector (optional — dropdown of active loans, same as transfer picker pattern)

**Controls:**
- "+ Add split" button — appends a new blank row
- Trash icon on each row — removes it (disabled when only 2 rows remain)
- Running remainder display: *"$X.XX remaining"* — green at $0.00 (±$0.01), red otherwise
- Save button — disabled until balanced
- "Remove split" button (footer, only shown when transaction is already split) — confirms then calls DELETE endpoint

**Pre-population when editing existing splits:** Dialog opens with children pre-filled from existing split data.

### API Client (`src/api/transactions.js`)
```javascript
export const splitTransaction = (id, splits) => api.post(`/transactions/${id}/split`, splits).then(r => r.data);
export const unsplitTransaction = (id) => api.delete(`/transactions/${id}/split`).then(r => r.data);
```

---

## 4. Testing

New test file: `backend/tests/test_split.py`

| Test | Assertion |
|------|-----------|
| Split creates correct children | Amounts, descriptions, categories, loan links match payload |
| Split sets is_split_parent on parent | `parent.is_split_parent == True` |
| Children excluded from dashboard totals | Summary counts only child amounts |
| Re-split replaces children | Old children gone, new ones present |
| Unsplit removes children, resets flag | Children deleted, `is_split_parent = False` |
| Validation: fewer than 2 splits → 422 | |
| Validation: amounts don't sum → 422 | |
| Validation: splitting a child → 400 | |
| Validation: amount ≤ 0 → 422 | |
| GET /transactions excludes split parents | Top-level list has no `is_split_parent=True` rows |
| Loan schedule matching uses child tx | Amortisation row shows repayment from child |
