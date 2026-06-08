"""
Pydantic schemas for API request/response validation.

Naming convention:
- *Create: fields required to create a resource
- *Update: fields that can be patched (all optional)
- *Response: fields returned to the frontend
"""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


# ── Assets ──────────────────────────────────────────────────

class AssetCreate(BaseModel):
    """POST /assets — create a new asset."""
    asset_name: str = Field(..., min_length=1, max_length=200)
    asset_type: str = Field(
        default="property", pattern="^(property|equity|stock_portfolio)$"
    )
    # Property fields
    address_street: str | None = Field(default=None, max_length=200)
    address_suburb: str | None = Field(default=None, max_length=100)
    address_state: str | None = Field(default=None, max_length=20)
    address_postcode: str | None = Field(default=None, max_length=10)
    purchase_price: float | None = None
    purchase_date: datetime | None = None
    current_value: float | None = None
    current_value_at: datetime | None = None
    is_rental: bool = False
    rental_income_monthly: float | None = None


class AssetUpdate(BaseModel):
    """PUT /assets/{id} — update an asset."""
    asset_name: str | None = Field(default=None, min_length=1, max_length=200)
    asset_type: str | None = Field(
        default=None, pattern="^(property|equity|stock_portfolio)$"
    )
    address_street: str | None = None
    address_suburb: str | None = None
    address_state: str | None = None
    address_postcode: str | None = None
    purchase_price: float | None = None
    purchase_date: datetime | None = None
    current_value: float | None = None
    current_value_at: datetime | None = None
    is_rental: bool | None = None
    rental_income_monthly: float | None = None


class AssetResponse(BaseModel):
    """Asset returned from GET endpoints."""
    id: int
    asset_name: str
    asset_type: str
    address_street: str | None = None
    address_suburb: str | None = None
    address_state: str | None = None
    address_postcode: str | None = None
    purchase_price: float | None = None
    purchase_date: datetime | None = None
    current_value: float | None = None
    current_value_at: datetime | None = None
    is_rental: bool
    rental_income_monthly: float | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


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
    # Loan fields
    asset_id: int | None = None
    loan_original_amount: float | None = None
    loan_interest_rate: float | None = None
    loan_start_date: datetime | None = None
    loan_term_years: int | None = None
    loan_repayment_type: str | None = Field(
        default=None, pattern="^(principal_and_interest|interest_only)$"
    )
    offset_account_id: int | None = None


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
    # Loan fields
    asset_id: int | None = None
    loan_original_amount: float | None = None
    loan_interest_rate: float | None = None
    loan_start_date: datetime | None = None
    loan_term_years: int | None = None
    loan_repayment_type: str | None = Field(
        default=None, pattern="^(principal_and_interest|interest_only)$"
    )
    offset_account_id: int | None = None


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
    # Loan fields
    asset_id: int | None = None
    loan_original_amount: float | None = None
    loan_interest_rate: float | None = None
    loan_start_date: datetime | None = None
    loan_term_years: int | None = None
    loan_repayment_type: str | None = None
    offset_account_id: int | None = None
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
    transfer_account_id: int | None = None


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
    transfer_account_id: int | None = None


class RuleUpdate(BaseModel):
    """PUT /rules/{id} — update a rule."""
    pattern: str | None = Field(default=None, min_length=1, max_length=500)
    category_id: int | None = None
    transfer_account_id: int | None = None
    is_active: bool | None = None


class RuleResponse(BaseModel):
    """Rule returned from GET endpoints."""
    id: int
    pattern: str
    category_id: int
    transfer_account_id: int | None
    transfer_account_name: str | None = None
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
    transfer_account_id: int | None
    category: CategoryResponse
    hit_count: int
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Loans ────────────────────────────────────────────────────

class LoanSummaryResponse(BaseModel):
    """GET /loans/{id}/summary — key metrics for a single loan."""
    account_id: int
    account_name: str
    account_number: str
    bank_name: str
    loan_repayment_type: str | None          # "principal_and_interest" | "interest_only" | None
    loan_interest_rate: float | None         # % p.a.
    loan_term_years: int | None
    loan_start_date: datetime | None
    loan_original_amount: float | None       # From account field (or derived from drawdown tx)
    current_balance: float | None            # abs(latest balance) — what is still owed
    total_interest_paid: float               # Sum of all Home Loan Interest transactions
    total_principal_paid: float              # original_amount - current_balance
    percent_paid: float | None               # principal_paid / original * 100
    avg_monthly_payment: float | None        # Average of last 3 months' payments
    projected_payoff_date: str | None        # ISO date string or None if interest-only / rate not set
    asset_id: int | None
    asset: AssetResponse | None


class LoanHistoryRow(BaseModel):
    """One month in a loan's payment history."""
    month: str                               # "2026-03"
    payment: float                           # Total credit to loan account
    interest: float                          # Interest charged
    principal: float                         # payment - interest
    balance: float | None                    # End-of-month balance (negative = owed)


# ── Stock Trades & Holdings ───────────────────────────────────

class StockTradeResponse(BaseModel):
    """A single stock trade returned from GET endpoints."""
    id: int
    account_id: int
    trade_date: datetime
    settlement_date: datetime | None
    security_name: str
    security_code: str
    trade_type: str
    quantity: float | None
    avg_price: float | None
    net_amount: float
    brokerage: float
    gst: float
    tax: float
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HoldingRow(BaseModel):
    """Aggregated holdings row for a single security in a brokerage account."""
    security_code: str
    security_name: str
    quantity_held: float
    avg_cost_per_unit: float | None
    cost_basis: float
    current_price: float | None
    current_value: float | None
    unrealised_gain: float | None
    unrealised_gain_pct: float | None
    total_dividends: float
    total_gain: float | None
    total_return_pct: float | None
    arr: float | None
    arr_short_hold: bool
    first_buy_date: date | None
    brokerage_total: float


class DividendRow(BaseModel):
    """Monthly dividend total per security."""
    month: str
    security_code: str
    security_name: str
    amount: float


class PerformanceRow(BaseModel):
    """Monthly portfolio cumulative cost basis snapshot."""
    month: str
    cost_basis: float
    portfolio_value: float | None


class HoldingPriceUpdate(BaseModel):
    """PATCH /investments/holdings/{account_id}/{security_code}/price"""
    price: float = Field(..., gt=0)


class PriceRefreshResult(BaseModel):
    """Per-security result from a price-refresh call."""
    security_code: str
    price: float | None
    error: str | None = None


class PriceRefreshResponse(BaseModel):
    """POST /investments/{account_id}/refresh-prices"""
    updated: int
    failed: list[str]
    results: list[PriceRefreshResult]
    holdings: list["HoldingRow"]
    account: "InvestmentResponse"


# ── Upload ───────────────────────────────────────────────────

class UploadResponse(BaseModel):
    """Response from POST /upload."""
    bank_name: str
    accounts_found: list[str]
    account_ids: list[int] = []
    total_rows: int
    inserted: int
    duplicates: int
    errors: list[str]


# ── Net Worth Journey ────────────────────────────────────────

class NetWorthPoint(BaseModel):
    """A single month in the net worth timeline."""
    month: str   # YYYY-MM
    cash: float
    investments: float
    properties: float
    loans: float
    net_worth: float


class NetWorthMilestone(BaseModel):
    """An auto-detected event marker on the net worth timeline."""
    month: str   # YYYY-MM
    type: str    # "journey_start" | "net_worth_milestone" | "property_purchase" | "investment_start"
    label: str
    amount: float | None = None


class NetWorthJourneyResponse(BaseModel):
    """Response for GET /networth/journey."""
    timeline: list[NetWorthPoint]
    milestones: list[NetWorthMilestone]
