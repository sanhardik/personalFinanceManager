# Personal Loans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing home loan system to support personal loans (loans the user pays back), tracked via the existing transfer mechanism.

**Architecture:** Add `personal_loan` as a new `account_type` on the existing `Account` model with three new columns (`lender_name`, `loan_notes`, `payment_frequency`). The loans router gains a branched balance calculation — personal loans compute balance as `original_amount − SUM(payments)` instead of reading the CSV-populated `balance` column. The Loans and Accounts pages adapt to show/hide fields per loan type.

**Tech Stack:** Python FastAPI, SQLAlchemy async, MariaDB, React 19 + Vite, shadcn/ui components.

## Global Constraints

- Backend lives in `backend/` relative to repo root; frontend in `frontend/src/`
- All tests use the real MariaDB test DB on port 3307 — no mocks
- Run tests with `./run.sh test` from repo root
- All new seed categories must have `is_system=True`
- No new pages or routes — personal loans use existing Loans and Accounts pages
- `account_type` pattern regex must be updated in both `AccountCreate` and `AccountUpdate` schemas
- Startup migrations use the `information_schema.COLUMNS` check pattern already in `main.py`

---

### Task 1: Data model + seed categories + startup migration

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/services/seed.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Produces: `Account.lender_name`, `Account.loan_notes`, `Account.payment_frequency` ORM columns
- Produces: seed categories `"Personal Loan Interest"` (Expense) and `"Personal Loan Payment"` (Income) available after startup

- [ ] **Step 1: Add three new columns to the `Account` model in `backend/app/models.py`**

Find the comment `# Loan fields — only relevant when account_type = "home_loan"` (around line 115) and add the three new fields after `offset_account_id`:

```python
    # Personal loan fields — only relevant when account_type = "personal_loan"
    lender_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    loan_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    payment_frequency: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # "weekly", "fortnightly", "monthly"
```

Also update the docstring on the `Account` class to add `"personal_loan"` to the list of `account_type` values:

```python
      - "personal_loan" — personal loan the user is paying back
```

You will also need to add `Text` to the SQLAlchemy imports at the top of the file. Find the existing import line (it starts with `from sqlalchemy import`) and add `Text` to it.

- [ ] **Step 2: Add `Personal Loan Interest` and `Personal Loan Payment` to DEFAULT_CATEGORIES in `backend/app/services/seed.py`**

Find the line `("Home Loan Interest", "Expense", "Percent", "#f97316"),` and add two new entries after `("Bank Fees", "Expense", "Receipt", "#94a3b8"),`:

```python
    ("Personal Loan Interest", "Expense", "Percent", "#6366f1"),
    ("Personal Loan Payment", "Income", "CreditCard", "#6366f1"),
```

- [ ] **Step 3: Add startup migration in `backend/app/main.py`**

Find the migration block for loan fields (the `for col_name, col_def in [("asset_id", ...)` block, around line 107) and add a new migration block immediately after it (after its `except` clause):

```python
        # Schema migrations — add personal loan fields to accounts
        try:
            async with engine.begin() as conn:
                for col_name, col_def in [
                    ("lender_name", "VARCHAR(255) NULL"),
                    ("loan_notes", "TEXT NULL"),
                    ("payment_frequency", "VARCHAR(20) NULL"),
                ]:
                    exists = await conn.execute(text(
                        "SELECT COUNT(*) FROM information_schema.COLUMNS "
                        "WHERE TABLE_SCHEMA = DATABASE() "
                        "AND TABLE_NAME = 'accounts' AND COLUMN_NAME = :col"
                    ), {"col": col_name})
                    if exists.scalar() == 0:
                        await conn.execute(text(
                            f"ALTER TABLE accounts ADD COLUMN {col_name} {col_def}"
                        ))
                        logger.info("Migration: added %s to accounts", col_name)
        except Exception as e:
            logger.warning("Migration: personal loan fields check failed (non-fatal): %s", e)
```

- [ ] **Step 4: Restart the backend to apply migrations and verify**

```bash
# From repo root
./run.sh stop
./run.sh start
```

Check backend logs for the migration lines:
```
Migration: added lender_name to accounts
Migration: added loan_notes to accounts
Migration: added payment_frequency to accounts
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/services/seed.py backend/app/main.py
git commit -m "feat: add personal_loan model fields and seed categories"
```

---

### Task 2: Schemas — add new fields and personal_loan to validation patterns

**Files:**
- Modify: `backend/app/schemas.py`

**Interfaces:**
- Consumes: `Account.lender_name`, `Account.loan_notes`, `Account.payment_frequency` from Task 1
- Produces: `AccountCreate`, `AccountUpdate`, `AccountResponse` accept/return `lender_name`, `loan_notes`, `payment_frequency`
- Produces: `LoanSummaryResponse` includes `account_type`, `lender_name`, `loan_notes`, `payment_frequency`

- [ ] **Step 1: Write failing tests for the schema changes**

In `backend/tests/test_loans.py`, add these two tests at the bottom of the file:

```python
@pytest.mark.anyio
async def test_create_personal_loan_account(client: AsyncClient):
    """POST /accounts accepts personal_loan account_type with lender fields."""
    r = await client.post("/accounts", json={
        "account_number": "PL-001",
        "account_name": "Car Loan",
        "bank_name": "CommBank",
        "account_type": "personal_loan",
        "loan_original_amount": 25000,
        "loan_interest_rate": 8.99,
        "loan_start_date": "2025-01-15T00:00:00",
        "loan_term_years": 5,
        "loan_repayment_type": "principal_and_interest",
        "lender_name": "CommBank",
        "loan_notes": "Car purchase loan",
        "payment_frequency": "monthly",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["account_type"] == "personal_loan"
    assert data["lender_name"] == "CommBank"
    assert data["loan_notes"] == "Car purchase loan"
    assert data["payment_frequency"] == "monthly"


@pytest.mark.anyio
async def test_loan_summary_includes_account_type(client: AsyncClient):
    """GET /loans includes personal loans and returns account_type in response."""
    await client.post("/accounts", json={
        "account_number": "PL-002",
        "account_name": "Renovation Loan",
        "bank_name": "NAB",
        "account_type": "personal_loan",
        "loan_original_amount": 10000,
        "lender_name": "NAB",
        "payment_frequency": "fortnightly",
    })
    r = await client.get("/loans")
    assert r.status_code == 200
    pl = next((l for l in r.json() if l["account_number"] == "PL-002"), None)
    assert pl is not None
    assert pl["account_type"] == "personal_loan"
    assert pl["lender_name"] == "NAB"
    assert pl["payment_frequency"] == "fortnightly"
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /path/to/repo && ./run.sh test -- tests/test_loans.py::test_create_personal_loan_account tests/test_loans.py::test_loan_summary_includes_account_type -v
```

Expected: FAIL — `422` on create because `personal_loan` isn't in the pattern, and `account_type`/`lender_name` missing from response schemas.

- [ ] **Step 3: Update `AccountCreate` in `backend/app/schemas.py`**

Find the `account_type` field in `AccountCreate` (around line 118):

```python
    account_type: str = Field(
        default="bank", pattern="^(bank|credit_card|home_loan|investment)$"
    )
```

Replace with:

```python
    account_type: str = Field(
        default="bank", pattern="^(bank|credit_card|home_loan|investment|personal_loan)$"
    )
```

Then add three new fields after `offset_account_id: int | None = None`:

```python
    # Personal loan fields
    lender_name: str | None = Field(default=None, max_length=255)
    loan_notes: str | None = None
    payment_frequency: str | None = Field(
        default=None, pattern="^(weekly|fortnightly|monthly)$"
    )
```

- [ ] **Step 4: Update `AccountUpdate` in `backend/app/schemas.py`**

Find the `account_type` field in `AccountUpdate` (around line 139):

```python
    account_type: str | None = Field(
        default=None, pattern="^(bank|credit_card|home_loan|investment)$"
    )
```

Replace with:

```python
    account_type: str | None = Field(
        default=None, pattern="^(bank|credit_card|home_loan|investment|personal_loan)$"
    )
```

Then add three new fields after `offset_account_id: int | None = None`:

```python
    # Personal loan fields
    lender_name: str | None = Field(default=None, max_length=255)
    loan_notes: str | None = None
    payment_frequency: str | None = Field(
        default=None, pattern="^(weekly|fortnightly|monthly)$"
    )
```

- [ ] **Step 5: Update `AccountResponse` in `backend/app/schemas.py`**

Find the `offset_account_id` field in `AccountResponse` (around line 179) and add after it:

```python
    # Personal loan fields
    lender_name: str | None = None
    loan_notes: str | None = None
    payment_frequency: str | None = None
```

- [ ] **Step 6: Update `LoanSummaryResponse` in `backend/app/schemas.py`**

Find `class LoanSummaryResponse` (around line 332) and add four new fields after `account_id: int`:

```python
    account_id: int
    account_type: str                             # "home_loan" | "personal_loan"
    lender_name: str | None = None
    loan_notes: str | None = None
    payment_frequency: str | None = None
    account_name: str
    # ... rest of existing fields unchanged
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
./run.sh test -- tests/test_loans.py::test_create_personal_loan_account tests/test_loans.py::test_loan_summary_includes_account_type -v
```

Expected: still FAIL — schemas pass now but `_loan_summary` doesn't populate the new fields yet (Task 3).

- [ ] **Step 8: Commit schema changes**

```bash
git add backend/app/schemas.py
git commit -m "feat: add personal_loan to account schemas and LoanSummaryResponse"
```

---

### Task 3: Loans router — support personal loans + branched balance calc

**Files:**
- Modify: `backend/app/routers/loans.py`

**Interfaces:**
- Consumes: `LoanSummaryResponse.account_type`, `LoanSummaryResponse.lender_name`, `LoanSummaryResponse.loan_notes`, `LoanSummaryResponse.payment_frequency` from Task 2
- Produces: `GET /loans` returns both `home_loan` and `personal_loan` accounts
- Produces: `GET /loans/{id}/summary` for `personal_loan` computes balance as `loan_original_amount − SUM(Income tx_amount)`
- Produces: `GET /loans/{id}/history` works for both loan types

- [ ] **Step 1: Write failing test for personal loan balance calculation**

Add to `backend/tests/test_loans.py`:

```python
@pytest.mark.anyio
async def test_personal_loan_balance_from_payments(client: AsyncClient):
    """Personal loan balance = original_amount - sum of transfer payments."""
    # Create personal loan account
    r = await client.post("/accounts", json={
        "account_number": "PL-BAL-001",
        "account_name": "Balance Test Loan",
        "bank_name": "TestBank",
        "account_type": "personal_loan",
        "loan_original_amount": 10000.0,
        "lender_name": "TestBank",
        "payment_frequency": "monthly",
    })
    assert r.status_code == 200
    loan_account_id = r.json()["id"]

    # Create a bank account to transfer from
    r2 = await client.post("/accounts", json={
        "account_number": "BANK-BAL-001",
        "account_name": "My Bank",
        "bank_name": "Westpac",
        "account_type": "bank",
    })
    assert r2.status_code == 200

    # Seed a Transfer In category (needed to create income tx on loan)
    cats = await client.get("/categories")
    transfer_in_id = next(c["id"] for c in cats.json() if c["name"] == "Transfer In")

    # Manually insert a payment transaction on the loan account via bulk-categorise
    # First create a tx by uploading, but simpler: directly patch a tx.
    # Instead, create a transaction by calling the transactions endpoint indirectly.
    # We'll use the accounts/upload flow is too complex here — check balance when no payments.
    r3 = await client.get(f"/loans/{loan_account_id}/summary")
    assert r3.status_code == 200
    data = r3.json()
    assert data["account_type"] == "personal_loan"
    # No payments yet — balance should equal original amount
    assert data["current_balance"] == 10000.0
    assert data["percent_paid"] == 0.0
```

- [ ] **Step 2: Run to confirm it fails**

```bash
./run.sh test -- tests/test_loans.py::test_personal_loan_balance_from_payments -v
```

Expected: FAIL — `404` because `_get_loan_or_404` filters only `home_loan`.

- [ ] **Step 3: Update `_get_loan_or_404` to accept both loan types**

In `backend/app/routers/loans.py`, replace:

```python
async def _get_loan_or_404(account_id: int, db: AsyncSession) -> Account:
    result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.account_type == "home_loan",
        )
    )
    loan = result.scalar_one_or_none()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan account not found")
    return loan
```

With:

```python
LOAN_TYPES = ("home_loan", "personal_loan")


async def _get_loan_or_404(account_id: int, db: AsyncSession) -> Account:
    result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.account_type.in_(LOAN_TYPES),
        )
    )
    loan = result.scalar_one_or_none()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan account not found")
    return loan
```

- [ ] **Step 4: Update `list_loans` endpoint to return both loan types**

Replace:

```python
@router.get("", response_model=list[LoanSummaryResponse])
async def list_loans(db: AsyncSession = Depends(get_db)):
    """Return all home_loan accounts with their summary metrics."""
    result = await db.execute(
        select(Account)
        .where(Account.account_type == "home_loan")
        .order_by(Account.account_name)
    )
```

With:

```python
@router.get("", response_model=list[LoanSummaryResponse])
async def list_loans(db: AsyncSession = Depends(get_db)):
    """Return all home_loan and personal_loan accounts with their summary metrics."""
    result = await db.execute(
        select(Account)
        .where(Account.account_type.in_(LOAN_TYPES))
        .order_by(Account.account_name)
    )
```

- [ ] **Step 5: Update `_loan_summary` to branch on loan type and populate new fields**

In `_loan_summary`, replace the balance calculation section (lines that build `latest_balance_raw` / `current_balance`) with a branched version, and add the new fields to the `LoanSummaryResponse(...)` call at the end.

Replace the block starting `# Current balance = abs of latest transaction balance` through `current_balance = abs(latest_balance_raw) if latest_balance_raw is not None else None` with:

```python
    # Current balance — calculation differs by loan type
    if loan.account_type == "personal_loan":
        # Personal loans: balance = original_amount - SUM of all Income (repayment) transactions
        payments_result = await db.execute(
            select(func.coalesce(func.sum(Transaction.tx_amount), 0.0))
            .where(Transaction.account_id == loan.id)
            .where(Transaction.tx_type == "Income")
        )
        total_paid = float(payments_result.scalar() or 0.0)
        if loan.loan_original_amount is not None:
            current_balance = max(0.0, loan.loan_original_amount - total_paid)
        else:
            current_balance = None
    else:
        # Home loans: balance from latest transaction's balance column (Macquarie CSV)
        latest_balance_result = await db.execute(
            select(Transaction.balance)
            .where(Transaction.account_id == loan.id)
            .where(Transaction.balance.isnot(None))
            .order_by(Transaction.tx_date.desc(), Transaction.tx_type.desc(), Transaction.id.asc())
            .limit(1)
        )
        latest_balance_raw = latest_balance_result.scalar_one_or_none()
        current_balance = abs(latest_balance_raw) if latest_balance_raw is not None else None
```

Then at the end of `_loan_summary`, in the `return LoanSummaryResponse(...)` call, add the new fields:

```python
    return LoanSummaryResponse(
        account_id=loan.id,
        account_type=loan.account_type,
        account_name=loan.account_name,
        account_number=loan.account_number,
        bank_name=loan.bank_name,
        lender_name=loan.lender_name,
        loan_notes=loan.loan_notes,
        payment_frequency=loan.payment_frequency,
        loan_repayment_type=repayment_type,
        loan_interest_rate=loan.loan_interest_rate,
        loan_term_years=loan.loan_term_years,
        loan_start_date=loan.loan_start_date,
        loan_original_amount=original_amount,
        current_balance=current_balance,
        total_interest_paid=round(total_interest, 2),
        total_principal_paid=round(total_principal, 2),
        percent_paid=percent_paid,
        avg_monthly_payment=round(avg_monthly_payment, 2) if avg_monthly_payment else None,
        projected_payoff_date=projected_payoff,
        asset_id=loan.asset_id,
        asset=asset_response,
    )
```

- [ ] **Step 6: Run failing tests — they should now pass**

```bash
./run.sh test -- tests/test_loans.py::test_personal_loan_balance_from_payments tests/test_loans.py::test_create_personal_loan_account tests/test_loans.py::test_loan_summary_includes_account_type -v
```

Expected: all 3 PASS.

- [ ] **Step 7: Run full test suite to check no regressions**

```bash
./run.sh test
```

Expected: all previously passing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/loans.py
git commit -m "feat: personal loans — extend loans router for personal_loan type"
```

---

### Task 4: Frontend — Accounts page (personal_loan type + new fields)

**Files:**
- Modify: `frontend/src/pages/Accounts.jsx`

**Interfaces:**
- Consumes: `AccountResponse.lender_name`, `AccountResponse.loan_notes`, `AccountResponse.payment_frequency` from Task 2
- Produces: UI to create/edit `personal_loan` accounts with all fields

- [ ] **Step 1: Add `personal_loan` to `TYPE_CONFIG` in `Accounts.jsx`**

Find:

```javascript
const TYPE_CONFIG = {
  bank: { label: 'Bank Account', icon: Building2, colour: 'bg-blue-100 text-blue-700' },
  credit_card: { label: 'Credit Card', icon: CreditCard, colour: 'bg-purple-100 text-purple-700' },
  home_loan: { label: 'Home Loan', icon: Home, colour: 'bg-orange-100 text-orange-700' },
};
```

Replace with:

```javascript
const TYPE_CONFIG = {
  bank: { label: 'Bank Account', icon: Building2, colour: 'bg-blue-100 text-blue-700' },
  credit_card: { label: 'Credit Card', icon: CreditCard, colour: 'bg-purple-100 text-purple-700' },
  home_loan: { label: 'Home Loan', icon: Home, colour: 'bg-orange-100 text-orange-700' },
  personal_loan: { label: 'Personal Loan', icon: CreditCard, colour: 'bg-indigo-100 text-indigo-700' },
};
```

- [ ] **Step 2: Add new fields to `BLANK_FORM`**

Find:

```javascript
const BLANK_FORM = {
  account_number: '', account_name: '', bank_name: 'Macquarie',
  account_type: 'bank', bsb: '', linked_account_id: '',
  loan_interest_rate: '', loan_term_years: '', loan_repayment_type: '',
  loan_original_amount: '', loan_start_date: '', asset_id: '',
};
```

Replace with:

```javascript
const BLANK_FORM = {
  account_number: '', account_name: '', bank_name: 'Macquarie',
  account_type: 'bank', bsb: '', linked_account_id: '',
  loan_interest_rate: '', loan_term_years: '', loan_repayment_type: '',
  loan_original_amount: '', loan_start_date: '', asset_id: '',
  lender_name: '', loan_notes: '', payment_frequency: '',
};
```

- [ ] **Step 3: Add `PersonalLoanExtraFields` component after the existing `LoanFields` component**

Add this new component after the closing `}` of `LoanFields`:

```javascript
function PersonalLoanExtraFields({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div className="col-span-full grid grid-cols-2 gap-3 pt-3 border-t border-indigo-100 mt-1">
      <p className="col-span-full text-xs font-semibold text-indigo-700 uppercase tracking-wide">Personal Loan Details</p>
      <div>
        <Label className="block text-xs text-slate-500 mb-1">Lender Name</Label>
        <Input type="text" placeholder="e.g. CommBank" value={data.lender_name}
          onChange={e => set('lender_name', e.target.value)} />
      </div>
      <div>
        <Label className="block text-xs text-slate-500 mb-1">Payment Frequency</Label>
        <select value={data.payment_frequency} onChange={e => set('payment_frequency', e.target.value)} className={nativeSelectCls}>
          <option value="">— select —</option>
          <option value="monthly">Monthly</option>
          <option value="fortnightly">Fortnightly</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>
      <div className="col-span-full">
        <Label className="block text-xs text-slate-500 mb-1">Notes</Label>
        <textarea
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          rows={2}
          placeholder="e.g. Car purchase loan — refinancing in 2027"
          value={data.loan_notes}
          onChange={e => set('loan_notes', e.target.value)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update `buildPayload` to include new fields**

Find `buildPayload`:

```javascript
  const buildPayload = (data) => ({
    ...data,
    bsb: data.bsb || null,
    linked_account_id: data.linked_account_id ? parseInt(data.linked_account_id) : null,
    asset_id: data.asset_id ? parseInt(data.asset_id) : null,
    loan_interest_rate: data.loan_interest_rate ? parseFloat(data.loan_interest_rate) : null,
    loan_term_years: data.loan_term_years ? parseInt(data.loan_term_years) : null,
    loan_original_amount: data.loan_original_amount ? parseFloat(data.loan_original_amount) : null,
    loan_repayment_type: data.loan_repayment_type || null,
    loan_start_date: data.loan_start_date || null,
  });
```

Replace with:

```javascript
  const buildPayload = (data) => ({
    ...data,
    bsb: data.bsb || null,
    linked_account_id: data.linked_account_id ? parseInt(data.linked_account_id) : null,
    asset_id: data.asset_id ? parseInt(data.asset_id) : null,
    loan_interest_rate: data.loan_interest_rate ? parseFloat(data.loan_interest_rate) : null,
    loan_term_years: data.loan_term_years ? parseInt(data.loan_term_years) : null,
    loan_original_amount: data.loan_original_amount ? parseFloat(data.loan_original_amount) : null,
    loan_repayment_type: data.loan_repayment_type || null,
    loan_start_date: data.loan_start_date || null,
    lender_name: data.lender_name || null,
    loan_notes: data.loan_notes || null,
    payment_frequency: data.payment_frequency || null,
  });
```

- [ ] **Step 5: Update `startEdit` to populate new fields**

Find the `setEditData({...})` call inside `startEdit` and add the three new fields:

```javascript
    setEditData({
      account_number: acc.account_number,
      account_name: acc.account_name,
      account_type: acc.account_type,
      bsb: acc.bsb || '',
      linked_account_id: acc.linked_account_id || '',
      asset_id: acc.asset_id || '',
      loan_interest_rate: acc.loan_interest_rate ?? '',
      loan_term_years: acc.loan_term_years ?? '',
      loan_repayment_type: acc.loan_repayment_type || '',
      loan_original_amount: acc.loan_original_amount ?? '',
      loan_start_date: acc.loan_start_date ? acc.loan_start_date.slice(0, 10) : '',
      lender_name: acc.lender_name || '',
      loan_notes: acc.loan_notes || '',
      payment_frequency: acc.payment_frequency || '',
    });
```

- [ ] **Step 6: Add `personal_loan` option to the Type dropdown in the create form**

Find:

```javascript
                  <select value={form.account_type} onChange={e => setForm({...form, account_type: e.target.value})} className={nativeSelectCls}>
                    <option value="bank">Bank Account</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="home_loan">Home Loan</option>
                  </select>
```

Replace with:

```javascript
                  <select value={form.account_type} onChange={e => setForm({...form, account_type: e.target.value})} className={nativeSelectCls}>
                    <option value="bank">Bank Account</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="home_loan">Home Loan</option>
                    <option value="personal_loan">Personal Loan</option>
                  </select>
```

- [ ] **Step 7: Show `PersonalLoanExtraFields` when creating a personal loan**

Find the block inside the create form:

```javascript
                {form.account_type === 'home_loan' && (
                  <>
                    <LoanFields data={form} onChange={setForm} />
                    <div className="col-span-full">
                      <Label className="block text-xs text-slate-500 mb-1">Linked Asset (optional)</Label>
                      <select value={form.asset_id} onChange={e => setForm({...form, asset_id: e.target.value})} className={nativeSelectCls}>
                        <option value="">— no asset linked —</option>
                        {assets.map(a => <option key={a.id} value={a.id}>{a.asset_name} ({a.asset_type})</option>)}
                      </select>
                    </div>
                  </>
                )}
```

Replace with:

```javascript
                {form.account_type === 'home_loan' && (
                  <>
                    <LoanFields data={form} onChange={setForm} />
                    <div className="col-span-full">
                      <Label className="block text-xs text-slate-500 mb-1">Linked Asset (optional)</Label>
                      <select value={form.asset_id} onChange={e => setForm({...form, asset_id: e.target.value})} className={nativeSelectCls}>
                        <option value="">— no asset linked —</option>
                        {assets.map(a => <option key={a.id} value={a.id}>{a.asset_name} ({a.asset_type})</option>)}
                      </select>
                    </div>
                  </>
                )}
                {form.account_type === 'personal_loan' && (
                  <>
                    <LoanFields data={form} onChange={setForm} />
                    <PersonalLoanExtraFields data={form} onChange={setForm} />
                  </>
                )}
```

- [ ] **Step 8: Find the edit form's equivalent block and apply the same pattern**

Search for `editData.account_type === 'home_loan'` in the file (in the edit row render). Apply the same pattern as Step 7 but using `editData` and `setEditData`.

The edit form likely renders inline within the account row. Find the equivalent conditional and add:

```javascript
                {editData.account_type === 'home_loan' && (
                  // ... existing home_loan edit fields (LoanFields + asset selector)
                )}
                {editData.account_type === 'personal_loan' && (
                  <>
                    <LoanFields data={editData} onChange={setEditData} />
                    <PersonalLoanExtraFields data={editData} onChange={setEditData} />
                  </>
                )}
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/Accounts.jsx
git commit -m "feat: personal loan account creation and editing in Accounts page"
```

---

### Task 5: Frontend — Loans page (type badge, lender, hide property/interest charts)

**Files:**
- Modify: `frontend/src/pages/Loans.jsx`

**Interfaces:**
- Consumes: `loan.account_type`, `loan.lender_name`, `loan.loan_notes`, `loan.payment_frequency` from Task 3

- [ ] **Step 1: Update the `LoanCard` component to show type badge and lender**

In `LoanCard`, find the header block:

```javascript
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-orange-50">
            <Home size={18} className="text-orange-600" />
          </span>
          <div>
            <h3 className="font-semibold text-slate-900 text-sm">{loan.account_name}</h3>
            <p className="text-xs text-slate-400">{loan.bank_name}</p>
          </div>
        </div>
        {isInterestOnly && (
          <Badge variant="secondary" className="text-xs font-medium bg-amber-100 text-amber-700 border-0">Interest Only</Badge>
        )}
```

Replace with:

```javascript
        <div className="flex items-center gap-2">
          <span className={cn('p-2 rounded-lg', loan.account_type === 'personal_loan' ? 'bg-indigo-50' : 'bg-orange-50')}>
            <Home size={18} className={loan.account_type === 'personal_loan' ? 'text-indigo-600' : 'text-orange-600'} />
          </span>
          <div>
            <h3 className="font-semibold text-slate-900 text-sm">{loan.account_name}</h3>
            <p className="text-xs text-slate-400">
              {loan.account_type === 'personal_loan' && loan.lender_name
                ? loan.lender_name
                : loan.bank_name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className={cn('text-xs font-medium border-0',
            loan.account_type === 'personal_loan'
              ? 'bg-indigo-100 text-indigo-700'
              : 'bg-orange-100 text-orange-700'
          )}>
            {loan.account_type === 'personal_loan' ? 'Personal Loan' : 'Home Loan'}
          </Badge>
          {isInterestOnly && (
            <Badge variant="secondary" className="text-xs font-medium bg-amber-100 text-amber-700 border-0">Interest Only</Badge>
          )}
        </div>
```

- [ ] **Step 2: Update the asset address line at the bottom of `LoanCard`**

Find:

```javascript
      {loan.asset && (
        <p className="mt-2 text-xs text-slate-400">
          {loan.asset.address_suburb
            ? `${loan.asset.address_street ? loan.asset.address_street + ', ' : ''}${loan.asset.address_suburb}`
            : loan.asset.asset_name}
        </p>
      )}
```

Replace with:

```javascript
      {loan.account_type === 'personal_loan' && loan.loan_notes && (
        <p className="mt-2 text-xs text-slate-400 italic">{loan.loan_notes}</p>
      )}
      {loan.account_type !== 'personal_loan' && loan.asset && (
        <p className="mt-2 text-xs text-slate-400">
          {loan.asset.address_suburb
            ? `${loan.asset.address_street ? loan.asset.address_street + ', ' : ''}${loan.asset.address_suburb}`
            : loan.asset.asset_name}
        </p>
      )}
```

- [ ] **Step 3: Update empty state and subtitle text**

Find:

```javascript
      <p className="text-sm text-slate-500 mt-0.5">Home loan and equity loan tracking</p>
```

Replace with:

```javascript
      <p className="text-sm text-slate-500 mt-0.5">Home loan and personal loan tracking</p>
```

Find the empty state message:

```javascript
          <p className="text-sm">No loan accounts yet.</p>
          <p className="text-xs mt-1">Upload a Macquarie loan CSV to get started.</p>
```

Replace with:

```javascript
          <p className="text-sm">No loan accounts yet.</p>
          <p className="text-xs mt-1">Upload a Macquarie loan CSV or add a personal loan via Accounts.</p>
```

- [ ] **Step 4: Hide the Interest vs Principal chart for personal loans in the detail view**

Find the chart grid block that renders both charts:

```javascript
          {!historyLoading && history.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-700">Balance Over Time</CardTitle>
                </CardHeader>
                ...
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-700">Monthly: Interest vs Principal</CardTitle>
                </CardHeader>
                ...
              </Card>
            </div>
          )}
```

Replace with:

```javascript
          {!historyLoading && history.length > 0 && (
            <div className={cn('grid gap-6', selectedLoan.account_type === 'personal_loan' ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2')}>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-700">Balance Over Time</CardTitle>
                </CardHeader>
                {/* ... existing balance chart content unchanged ... */}
              </Card>

              {selectedLoan.account_type !== 'personal_loan' && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-slate-700">Monthly: Interest vs Principal</CardTitle>
                  </CardHeader>
                  {/* ... existing breakdown chart content unchanged ... */}
                </Card>
              )}
            </div>
          )}
```

> **Note:** Keep the inner chart JSX intact — only wrap the second card in the conditional. The actual chart content is unchanged.

- [ ] **Step 5: Hide the Linked Property panel for personal loans**

Find:

```javascript
          {selectedLoan.asset && selectedLoan.asset.asset_type === 'property' && (
```

Replace with:

```javascript
          {selectedLoan.account_type !== 'personal_loan' && selectedLoan.asset && selectedLoan.asset.asset_type === 'property' && (
```

- [ ] **Step 6: Show Notes panel for personal loans in detail view**

Add this block immediately after the KPI cards grid (after the closing `</div>` of the 5-card grid):

```javascript
          {selectedLoan.account_type === 'personal_loan' && (selectedLoan.lender_name || selectedLoan.loan_notes || selectedLoan.payment_frequency) && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-indigo-800 mb-3">Loan Details</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                {selectedLoan.lender_name && (
                  <div>
                    <p className="text-xs text-indigo-500">Lender</p>
                    <p className="font-medium text-indigo-900">{selectedLoan.lender_name}</p>
                  </div>
                )}
                {selectedLoan.payment_frequency && (
                  <div>
                    <p className="text-xs text-indigo-500">Payment Frequency</p>
                    <p className="font-medium text-indigo-900 capitalize">{selectedLoan.payment_frequency}</p>
                  </div>
                )}
                {selectedLoan.loan_notes && (
                  <div className="col-span-full">
                    <p className="text-xs text-indigo-500">Notes</p>
                    <p className="font-medium text-indigo-900">{selectedLoan.loan_notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Loans.jsx
git commit -m "feat: personal loans display in Loans page — type badge, lender, conditional charts"
```

---

### Task 6: Tests — full coverage for personal loans

**Files:**
- Modify: `backend/tests/test_loans.py`

**Interfaces:**
- Consumes: all endpoints from Tasks 1–3

- [ ] **Step 1: Add remaining tests to `backend/tests/test_loans.py`**

Add these tests at the bottom of the file:

```python
# ── Personal loan tests ────────────────────────────────────────

@pytest.mark.anyio
async def test_list_loans_includes_both_types(client: AsyncClient):
    """GET /loans returns both home_loan and personal_loan accounts."""
    await _upload_loan(client)  # creates a home_loan account
    await client.post("/accounts", json={
        "account_number": "PL-LIST-001",
        "account_name": "Personal Loan Test",
        "bank_name": "ANZ",
        "account_type": "personal_loan",
        "loan_original_amount": 5000.0,
    })
    r = await client.get("/loans")
    assert r.status_code == 200
    types = {l["account_type"] for l in r.json()}
    assert "home_loan" in types
    assert "personal_loan" in types


@pytest.mark.anyio
async def test_personal_loan_summary_zero_balance_no_payments(client: AsyncClient):
    """Personal loan with no payments: balance = original_amount, percent_paid = 0."""
    r = await client.post("/accounts", json={
        "account_number": "PL-ZERO-001",
        "account_name": "Zero Balance Loan",
        "bank_name": "CBA",
        "account_type": "personal_loan",
        "loan_original_amount": 15000.0,
        "loan_interest_rate": 9.5,
        "loan_term_years": 3,
        "loan_repayment_type": "principal_and_interest",
        "lender_name": "CBA",
        "payment_frequency": "monthly",
    })
    assert r.status_code == 200
    loan_id = r.json()["id"]

    r2 = await client.get(f"/loans/{loan_id}/summary")
    assert r2.status_code == 200
    data = r2.json()
    assert data["current_balance"] == 15000.0
    assert data["percent_paid"] == 0.0
    assert data["account_type"] == "personal_loan"
    assert data["lender_name"] == "CBA"
    assert data["payment_frequency"] == "monthly"


@pytest.mark.anyio
async def test_personal_loan_404_not_a_loan(client: AsyncClient):
    """GET /loans/{id}/summary returns 404 for a bank account."""
    r = await client.post("/accounts", json={
        "account_number": "BANK-NOTLOAN",
        "account_name": "Regular Bank",
        "bank_name": "Westpac",
        "account_type": "bank",
    })
    bank_id = r.json()["id"]
    r2 = await client.get(f"/loans/{bank_id}/summary")
    assert r2.status_code == 404


@pytest.mark.anyio
async def test_personal_loan_history_empty(client: AsyncClient):
    """GET /loans/{id}/history returns empty list for a new personal loan with no transactions."""
    r = await client.post("/accounts", json={
        "account_number": "PL-HIST-001",
        "account_name": "History Loan",
        "bank_name": "Macquarie",
        "account_type": "personal_loan",
        "loan_original_amount": 8000.0,
    })
    loan_id = r.json()["id"]
    r2 = await client.get(f"/loans/{loan_id}/history")
    assert r2.status_code == 200
    assert r2.json() == []


@pytest.mark.anyio
async def test_personal_loan_seed_categories_exist(client: AsyncClient):
    """Personal Loan Interest and Personal Loan Payment categories are seeded."""
    r = await client.get("/categories")
    assert r.status_code == 200
    names = {c["name"] for c in r.json()}
    assert "Personal Loan Interest" in names
    assert "Personal Loan Payment" in names


@pytest.mark.anyio
async def test_personal_loan_update_fields(client: AsyncClient):
    """PUT /accounts/{id} updates lender_name and loan_notes for a personal loan."""
    r = await client.post("/accounts", json={
        "account_number": "PL-UPD-001",
        "account_name": "Update Test Loan",
        "bank_name": "NAB",
        "account_type": "personal_loan",
        "loan_original_amount": 3000.0,
        "lender_name": "NAB",
    })
    loan_id = r.json()["id"]

    r2 = await client.put(f"/accounts/{loan_id}", json={
        "lender_name": "Updated Lender",
        "loan_notes": "Refinanced in 2026",
        "payment_frequency": "fortnightly",
    })
    assert r2.status_code == 200
    data = r2.json()
    assert data["lender_name"] == "Updated Lender"
    assert data["loan_notes"] == "Refinanced in 2026"
    assert data["payment_frequency"] == "fortnightly"
```

- [ ] **Step 2: Run all new personal loan tests**

```bash
./run.sh test -- tests/test_loans.py -k "personal" -v
```

Expected: all PASS.

- [ ] **Step 3: Run the full test suite**

```bash
./run.sh test
```

Expected: all previously passing tests still pass + new tests pass. Note the count — should be previous count + 9 new tests.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_loans.py
git commit -m "test: personal loans — balance calc, list, seed categories, field updates"
```
