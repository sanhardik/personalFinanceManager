"""
Pydantic schemas for API request/response validation.

Naming convention:
- *Create: fields required to create a resource
- *Update: fields that can be patched (all optional)
- *Response: fields returned to the frontend
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# ── Categories ──────────────────────────────────────────────

class CategoryCreate(BaseModel):
    """POST /categories — create a new category."""
    name: str = Field(..., min_length=1, max_length=200)
    category_type: str = Field(
        default="Expense", pattern="^(Income|Expense)$"
    )
    icon: str | None = Field(default=None, max_length=50)
    colour: str | None = Field(default=None, max_length=20)
    parent_id: int | None = None


class CategoryUpdate(BaseModel):
    """PUT /categories/{id} — update a category."""
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category_type: str | None = Field(default=None, pattern="^(Income|Expense)$")
    icon: str | None = None
    colour: str | None = None
    parent_id: int | None = None


class CategoryResponse(BaseModel):
    """Category returned from GET endpoints."""
    id: int
    name: str
    category_type: str
    icon: str | None
    colour: str | None
    is_system: bool
    parent_id: int | None = None
    parent_name: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Accounts ────────────────────────────────────────────────

class AccountCreate(BaseModel):
    """POST /accounts — create a new account manually."""
    account_number: str = Field(..., min_length=1, max_length=256)
    account_name: str = Field(default="", max_length=256)
    bank_name: str = Field(..., min_length=1, max_length=100)
    account_type: str = Field(
        default="bank", pattern="^(bank|credit_card|home_loan|investment)$"
    )
    bsb: str | None = Field(default=None, max_length=12)
    linked_account_id: int | None = None


class AccountUpdate(BaseModel):
    """PUT /accounts/{id} — update an account."""
    account_name: str | None = Field(default=None, max_length=256)
    bank_name: str | None = Field(default=None, max_length=100)
    account_type: str | None = Field(
        default=None, pattern="^(bank|credit_card|home_loan|investment)$"
    )
    account_number: str | None = Field(default=None, min_length=1, max_length=256)
    bsb: str | None = Field(default=None, max_length=12)
    linked_account_id: int | None = None
    is_active: bool | None = None
    current_value: float | None = None
    current_value_at: datetime | None = None


class AccountResponse(BaseModel):
    """Account returned from GET endpoints."""
    id: int
    account_number: str
    account_name: str
    bank_name: str
    account_type: str
    bsb: str | None = None
    is_active: bool
    linked_account_id: int | None
    current_value: float | None = None
    current_value_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InvestmentResponse(BaseModel):
    """GET /investments — investment account with contribution + return summary."""
    id: int
    account_name: str
    bank_name: str
    account_number: str
    total_contributed: float
    current_value: float | None
    current_value_at: datetime | None
    return_amount: float | None    # current_value - total_contributed
    return_pct: float | None       # return_amount / total_contributed * 100


# ── Transactions ─────────────────────────────────────────────

class TransactionResponse(BaseModel):
    """Transaction returned from GET endpoints."""
    id: int
    account_id: int
    category_id: int | None
    category_name: str | None = None
    tx_date: datetime
    tx_desc: str
    tx_amount: float
    tx_type: str
    balance: float | None
    original_category: str | None
    is_categorised: bool
    transfer_account_id: int | None = None
    transfer_account_name: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SuggestedRuleHint(BaseModel):
    """Embedded in PATCH /transactions/{id} when a rule suggestion is generated."""
    suggestion_id: int
    pattern: str
    category_id: int
    category_name: str
    hit_count: int
    auto_promoted: bool  # True when threshold reached and rule was auto-created


class TransactionPatchResponse(TransactionResponse):
    """PATCH /transactions/{id} response — includes similar transaction hint + rule suggestion."""
    similar_uncategorised: int = 0
    similar_prefix: str | None = None
    rule_suggestion: SuggestedRuleHint | None = None
    transfer_matched_account: str | None = None  # name of counterpart account if auto-matched


class TransactionUpdate(BaseModel):
    """PATCH /transactions/{id} — update category and optional transfer account."""
    category_id: int | None = None
    transfer_account_id: int | None = None


class BulkCategoriseRequest(BaseModel):
    """POST /transactions/bulk-categorise — set category on multiple transactions."""
    transaction_ids: list[int]
    category_id: int


class BulkCategoriseResponse(BaseModel):
    """Response from bulk categorise."""
    updated: int
    category_id: int
    category_name: str


# ── Rules ────────────────────────────────────────────────────

class RuleCreate(BaseModel):
    """POST /rules — create a new auto-categorisation rule."""
    pattern: str = Field(..., min_length=1, max_length=500)
    category_id: int


class RuleUpdate(BaseModel):
    """PUT /rules/{id} — update a rule."""
    pattern: str | None = Field(default=None, min_length=1, max_length=500)
    category_id: int | None = None
    is_active: bool | None = None


class RuleResponse(BaseModel):
    """Rule returned from GET endpoints."""
    id: int
    pattern: str
    category_id: int
    category: CategoryResponse
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AffectedTransaction(BaseModel):
    """A transaction affected by a rule change."""
    id: int
    tx_date: datetime
    tx_desc: str
    tx_amount: float
    tx_type: str

    model_config = ConfigDict(from_attributes=True)


class RuleAffectedResponse(BaseModel):
    """GET /rules/{id}/affected — transactions that would be re-categorised."""
    count: int
    old_category_id: int
    old_category_name: str
    transactions: list[AffectedTransaction]


# ── Suggested Rules ──────────────────────────────────────────

class SuggestedRuleResponse(BaseModel):
    """GET /rules/suggestions — a pending rule suggestion."""
    id: int
    pattern: str
    category_id: int
    category: CategoryResponse
    hit_count: int
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Upload ───────────────────────────────────────────────────

class UploadResponse(BaseModel):
    """Response from POST /upload."""
    bank_name: str
    accounts_found: list[str]
    total_rows: int
    inserted: int
    duplicates: int
    errors: list[str]
