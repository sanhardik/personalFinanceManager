"""
SQLAlchemy ORM models for Personal Finance Manager.

Tables:
- assets: Real assets (properties, equity, stock portfolios)
- accounts: Bank accounts, credit cards, home loans
- categories: Transaction categories (Groceries, Salary, etc.)
- transactions: Bank transactions linked to accounts and categories
- rules: Auto-categorisation rules (pattern → category)

All models inherit from database.Base (DeclarativeBase).
"""

import hashlib
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Asset(Base):
    """
    A real-world asset that accounts (loans) can be linked to.

    asset_type values:
      - "property"        — real estate (captures address, purchase price, rental)
      - "equity"          — equity loan / line of credit (no property fields)
      - "stock_portfolio" — stock/investment portfolio (model-ready, no UI yet)
    """

    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_name: Mapped[str] = mapped_column(String(200), nullable=False)
    asset_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="property"
    )  # "property", "equity", "stock_portfolio"

    # Property fields — only relevant when asset_type = "property"
    address_street: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address_suburb: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address_state: Mapped[str | None] = mapped_column(String(20), nullable=True)
    address_postcode: Mapped[str | None] = mapped_column(String(10), nullable=True)
    purchase_price: Mapped[float | None] = mapped_column(Float(precision=2), nullable=True)
    purchase_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    current_value: Mapped[float | None] = mapped_column(Float(precision=2), nullable=True)
    current_value_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_rental: Mapped[bool] = mapped_column(Boolean, default=False)
    rental_income_monthly: Mapped[float | None] = mapped_column(Float(precision=2), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    accounts: Mapped[list["Account"]] = relationship(
        "Account",
        back_populates="asset",
        foreign_keys="Account.asset_id",
    )

    def __repr__(self) -> str:
        return f"<Asset {self.asset_name} ({self.asset_type})>"


class Account(Base):
    """
    Bank account, credit card, or home loan.

    account_type values:
      - "bank"        — transaction/savings account
      - "credit_card" — credit card (last 4 digits as account_number)
      - "home_loan"   — mortgage / home loan
      - "investment"  — investment / brokerage account (e.g. Spaceship, CommSec)

    linked_account_id: optional FK to the bank account that pays this account.
    asset_id: optional FK to an Asset this loan is secured against.
    loan_repayment_type: "principal_and_interest" or "interest_only"
    offset_account_id: future — linked offset account (reduces interest).
    """

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_number: Mapped[str] = mapped_column(String(256), unique=True, nullable=False)
    account_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    bank_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    bsb: Mapped[str | None] = mapped_column(String(10), nullable=True)
    account_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="bank"
    )  # "bank", "credit_card", "home_loan", "investment"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    linked_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("accounts.id"), nullable=True
    )
    # Investment accounts: manually-entered current portfolio value
    current_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_value_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Loan fields — only relevant when account_type = "home_loan"
    asset_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("assets.id", ondelete="SET NULL"), nullable=True
    )
    loan_original_amount: Mapped[float | None] = mapped_column(Float(precision=2), nullable=True)
    loan_interest_rate: Mapped[float | None] = mapped_column(Float, nullable=True)  # % p.a.
    loan_start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    loan_term_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    loan_repayment_type: Mapped[str | None] = mapped_column(
        String(30), nullable=True
    )  # "principal_and_interest" or "interest_only"
    offset_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("accounts.id"), nullable=True
    )  # Future: linked offset account

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
        foreign_keys="Transaction.account_id",
    )
    linked_account: Mapped["Account | None"] = relationship(
        "Account", remote_side="Account.id", foreign_keys=[linked_account_id]
    )
    asset: Mapped["Asset | None"] = relationship(
        "Asset", back_populates="accounts", foreign_keys=[asset_id]
    )

    def __repr__(self) -> str:
        return f"<Account {self.account_number} ({self.bank_name} {self.account_type})>"


class Category(Base):
    """Transaction category — Income or Expense type."""

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    category_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="Expense"
    )  # "Income" or "Expense"
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    colour: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    parent_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    parent: Mapped["Category | None"] = relationship(
        "Category",
        remote_side="Category.id",
        foreign_keys="Category.parent_id",
        back_populates="children",
    )
    children: Mapped[list["Category"]] = relationship(
        "Category",
        foreign_keys="Category.parent_id",
        back_populates="parent",
    )
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="category"
    )
    rules: Mapped[list["Rule"]] = relationship(
        back_populates="category"
    )

    def __repr__(self) -> str:
        return f"<Category {self.name} ({self.category_type})>"


class Transaction(Base):
    """A single bank transaction — linked to account and optionally to category."""

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("accounts.id"), nullable=False
    )
    category_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("categories.id"), nullable=True
    )
    tx_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    tx_desc: Mapped[str] = mapped_column(Text, nullable=False)
    tx_amount: Mapped[float] = mapped_column(Float(precision=2), nullable=False)
    tx_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="Expense"
    )  # "Income" or "Expense"
    tx_hash: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False
    )  # SHA256 dedup hash
    balance: Mapped[float | None] = mapped_column(
        Float(precision=2), nullable=True
    )  # Balance after this transaction
    original_category: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )  # Category from bank CSV (e.g. "PAYMENT", "DEP", "OTHER")
    is_categorised: Mapped[bool] = mapped_column(Boolean, default=False)
    transfer_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )  # For Transfer In/Out: the other account involved
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    account: Mapped["Account"] = relationship(
        back_populates="transactions", foreign_keys="Transaction.account_id"
    )
    category: Mapped["Category | None"] = relationship(back_populates="transactions")
    transfer_account: Mapped["Account | None"] = relationship(
        "Account", foreign_keys="Transaction.transfer_account_id"
    )

    @staticmethod
    def compute_hash(account_id: int, tx_date: str, tx_desc: str, tx_amount: float) -> str:
        """SHA256 hash for dedup: (account_id + tx_date + tx_desc + tx_amount)."""
        raw = f"{account_id}|{tx_date}|{tx_desc}|{tx_amount}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def __repr__(self) -> str:
        return f"<Transaction {self.tx_date} {self.tx_amount} {self.tx_desc[:30]}>"


class Rule(Base):
    """Auto-categorisation rule — matches a pattern in transaction description."""

    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pattern: Mapped[str] = mapped_column(String(500), nullable=False)
    category_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("categories.id"), nullable=False
    )
    transfer_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("accounts.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    category: Mapped["Category"] = relationship(back_populates="rules")
    transfer_account: Mapped["Account | None"] = relationship(
        "Account", foreign_keys=[transfer_account_id]
    )

    def __repr__(self) -> str:
        return f"<Rule '{self.pattern}' → category_id={self.category_id}>"


class SuggestedRule(Base):
    """
    A rule suggestion generated by observing manual categorisation behaviour.

    Lifecycle:
      pending       — newly suggested; shown in the review queue (Option C)
      accepted      — user manually accepted → promoted to rules table
      dismissed     — user dismissed; never shown again
      auto_promoted — hit_count reached threshold → auto-promoted (Option B)

    hit_count tracks how many separate manual categorisations matched this
    pattern+category pair.  source_tx_ids is a JSON list of those tx IDs.
    """

    __tablename__ = "suggested_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pattern: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    category_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("categories.id"), nullable=False
    )
    transfer_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("accounts.id"), nullable=True
    )
    hit_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False
    )  # "pending" | "accepted" | "dismissed" | "auto_promoted"
    source_tx_ids: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # JSON list of tx IDs that triggered this suggestion
    promoted_rule_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("rules.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    category: Mapped["Category"] = relationship("Category")
    promoted_rule: Mapped["Rule | None"] = relationship("Rule")

    def __repr__(self) -> str:
        return f"<SuggestedRule '{self.pattern}' → category_id={self.category_id} hits={self.hit_count}>"
