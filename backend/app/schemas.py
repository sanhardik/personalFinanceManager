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


class CategoryUpdate(BaseModel):
    """PATCH /categories/{id} — update a category."""
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category_type: str | None = Field(default=None, pattern="^(Income|Expense)$")
    icon: str | None = None
    colour: str | None = None


class CategoryResponse(BaseModel):
    """Category returned from GET endpoints."""
    id: int
    name: str
    category_type: str
    icon: str | None
    colour: str | None
    is_system: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Accounts ────────────────────────────────────────────────

class AccountCreate(BaseModel):
    """POST /accounts — create a new account manually."""
    account_number: str = Field(..., min_length=1, max_length=256)
    account_name: str = Field(default="", max_length=256)
    bank_name: str = Field(..., min_length=1, max_length=100)
    account_type: str = Field(
        default="bank", pattern="^(bank|credit_card|home_loan)$"
    )
    linked_account_id: int | None = None


class AccountUpdate(BaseModel):
    """PUT /accounts/{id} — update an account."""
    account_name: str | None = Field(default=None, max_length=256)
    bank_name: str | None = Field(default=None, max_length=100)
    account_type: str | None = Field(
        default=None, pattern="^(bank|credit_card|home_loan)$"
    )
    linked_account_id: int | None = None
    is_active: bool | None = None


class AccountResponse(BaseModel):
    """Account returned from GET endpoints."""
    id: int
    account_number: str
    account_name: str
    bank_name: str
    account_type: str
    is_active: bool
    linked_account_id: int | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Transactions ─────────────────────────────────────────────

class TransactionResponse(BaseModel):
    """Transaction returned from GET endpoints."""
    id: int
    account_id: int
    category_id: int | None
    tx_date: datetime
    tx_desc: str
    tx_amount: float
    tx_type: str
    balance: float | None
    original_category: str | None
    is_categorised: bool
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
