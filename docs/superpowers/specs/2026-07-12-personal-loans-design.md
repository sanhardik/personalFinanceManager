# Personal Loans — Design Spec
**Date:** 2026-07-12
**Status:** Approved

## Overview

Add personal loan tracking (loans the user needs to pay back) alongside the existing home loan system. Repayments flow through the existing bank transaction transfer mechanism. No new pages or routes — personal loans appear in the existing Loans page and are created via the existing Accounts page.

---

## Data Model

### New columns on `accounts` table (startup migration)

| Column | Type | Notes |
|--------|------|-------|
| `lender_name` | `VARCHAR(255)` | Who the loan is from (e.g. "CommBank", "Family") |
| `loan_notes` | `TEXT` | Free-text notes |
| `payment_frequency` | `ENUM('weekly','fortnightly','monthly') DEFAULT 'monthly'` | Repayment schedule |

### New `account_type` value

`"personal_loan"` added as a valid value alongside `"bank"`, `"credit_card"`, `"home_loan"`.

### Reused loan fields

All existing loan fields on `accounts` are reused as-is:
- `loan_original_amount`, `loan_interest_rate`, `loan_start_date`, `loan_term_years`, `loan_repayment_type`

`asset_id` is left nullable and unused for personal loans.

### Balance calculation difference

- **Home loans**: `current_balance` = latest transaction's `balance` column (populated from Macquarie CSV)
- **Personal loans**: `current_balance` = `loan_original_amount − SUM(Transfer In transaction amounts)`

Repayments arrive via the existing transfer mechanism: the user categorises a bank debit as Transfer Out and links it to the personal loan account. The matching Transfer In on the loan account represents the repayment.

### New seed categories

| Name | Type |
|------|------|
| Personal Loan Interest | Expense |
| Personal Loan Payment | Income |

---

## Backend Changes

### `app/models.py`
- Add `lender_name`, `loan_notes`, `payment_frequency` columns to `Account`.

### `app/main.py` (startup migration)
- `ALTER TABLE accounts ADD COLUMN lender_name`, `loan_notes`, `payment_frequency` if not exists.

### `app/routers/loans.py`
- Change all `account_type = "home_loan"` filters to `account_type IN ("home_loan", "personal_loan")`.
- In `GET /loans/{id}/summary`: branch on `account_type`. For `personal_loan`, derive balance as `loan_original_amount - SUM(ABS(tx_amount) WHERE tx_type = 'Income')` instead of reading the latest transaction balance.

### `app/routers/accounts.py`
- Allow `"personal_loan"` in `account_type` validation.

### `app/schemas.py`
- Add `lender_name: str | None`, `loan_notes: str | None`, `payment_frequency: str | None` to `AccountCreate`, `AccountUpdate`, `AccountResponse`, `LoanSummaryResponse`.

### `app/services/seed.py`
- Add `Personal Loan Interest` (Expense) and `Personal Loan Payment` (Income) system categories.

---

## Frontend Changes

### `src/pages/Accounts.jsx`

When `account_type = "personal_loan"`:
- Show same loan fields as home loans: interest rate, repayment type, loan start date, loan term, original loan amount.
- Show three new fields: Lender Name (text), Payment Frequency (dropdown: Monthly / Fortnightly / Weekly), Notes (textarea).
- **Hide** the asset/property selector (home-loan-only).

### `src/pages/Loans.jsx`

Personal loans appear in the same card grid as home loans with these differences:

| Element | Home Loan | Personal Loan |
|---------|-----------|---------------|
| Type badge | "Home Loan" | "Personal Loan" |
| Secondary identifier | Property address/suburb | Lender name |
| Linked Property panel | Shown (LVR, equity, rental) | Hidden |
| Interest vs Principal chart | Shown | Hidden |
| Notes | — | Shown if populated |
| Balance source | Latest tx balance | Original − payments |

All other elements reused: balance, % paid progress bar, rate, term, avg monthly payment, projected payoff date.

---

## Reconciliation

Multiple personal loans are distinguished by descriptive account names set at creation time (e.g. "Car Loan", "Renovation Loan"). The transfer account selector already shows account names — no additional changes needed.

---

## Out of Scope

- Per-transaction interest breakdown for personal loans (interest doesn't flow through bank CSV)
- Offset accounts
- CSV import from personal loan lenders

---

## Testing

- Unit tests for balance calculation (personal loan path: original − payments)
- Integration tests: create personal loan account, record transfers, verify summary balance
- Loans list returns both home loans and personal loans
- Seed categories created correctly
- New account fields persisted and returned correctly
