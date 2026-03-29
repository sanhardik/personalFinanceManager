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

class AccountResponse(BaseModel):
    """Account returned from GET endpoints."""
    id: int
    account_number: str
    account_name: str
    bank_name: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Transactions (placeholder for Chunk 3+) ─────────────────

class TransactionResponse(BaseModel):
    """Transaction returned from GET endpoints."""
    id: int
    account_id: int
    category_id: int | None
    tx_date: datetime
    tx_desc: str
    tx_amount: float
    tx_type: str
    is_categorised: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
