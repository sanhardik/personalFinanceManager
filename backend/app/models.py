"""
SQLAlchemy ORM models for Personal Finance Manager.

Tables:
- accounts: Bank accounts (Westpac, NAB, Macquarie)
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


class Account(Base):
    """Bank account — one per BSB/account combination."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_number: Mapped[str] = mapped_column(String(256), unique=True, nullable=False)
    account_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    bank_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Account {self.account_number} ({self.bank_name})>"


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
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
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
    is_categorised: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    account: Mapped["Account"] = relationship(back_populates="transactions")
    category: Mapped["Category | None"] = relationship(back_populates="transactions")

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
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    category: Mapped["Category"] = relationship(back_populates="rules")

    def __repr__(self) -> str:
        return f"<Rule '{self.pattern}' → category_id={self.category_id}>"
