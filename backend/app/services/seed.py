"""
Seed default categories for the Personal Finance Manager.

These are common Australian transaction categories. System categories
(is_system=True) cannot be deleted by the user — they provide a baseline
for transaction categorisation.

Run automatically on app startup via lifespan events.
Only inserts categories that don't already exist (by name).
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Category

logger = logging.getLogger(__name__)

# Default Australian categories: (name, type, icon, colour)
DEFAULT_CATEGORIES: list[tuple[str, str, str, str]] = [
    # ── Expense categories ──
    ("Groceries", "Expense", "ShoppingCart", "#22c55e"),
    ("Utilities", "Expense", "Zap", "#eab308"),
    ("Rent", "Expense", "Home", "#f97316"),
    ("Mortgage", "Expense", "Building", "#f97316"),
    ("Insurance", "Expense", "Shield", "#6366f1"),
    ("Transport", "Expense", "Car", "#3b82f6"),
    ("Fuel", "Expense", "Fuel", "#64748b"),
    ("Dining Out", "Expense", "UtensilsCrossed", "#ec4899"),
    ("Entertainment", "Expense", "Film", "#a855f7"),
    ("Health & Medical", "Expense", "Heart", "#ef4444"),
    ("Education", "Expense", "GraduationCap", "#0ea5e9"),
    ("Clothing", "Expense", "Shirt", "#f472b6"),
    ("Personal Care", "Expense", "Sparkles", "#d946ef"),
    ("Subscriptions", "Expense", "RefreshCw", "#8b5cf6"),
    ("Phone & Internet", "Expense", "Wifi", "#06b6d4"),
    ("Childcare", "Expense", "Baby", "#fb923c"),
    ("Pets", "Expense", "Dog", "#a3e635"),
    ("Gifts & Donations", "Expense", "Gift", "#e11d48"),
    ("Home Maintenance", "Expense", "Wrench", "#78716c"),
    ("Travel", "Expense", "Plane", "#0284c7"),
    ("Fees & Charges", "Expense", "Receipt", "#94a3b8"),
    ("Tax", "Expense", "Calculator", "#dc2626"),
    ("Cash Withdrawal", "Expense", "Banknote", "#71717a"),
    ("Transfer Out", "Expense", "ArrowUpRight", "#64748b"),
    ("Other Expense", "Expense", "MoreHorizontal", "#94a3b8"),
    # ── Income categories ──
    ("Salary", "Income", "Briefcase", "#22c55e"),
    ("Interest", "Income", "Percent", "#3b82f6"),
    ("Dividends", "Income", "TrendingUp", "#8b5cf6"),
    ("Rental Income", "Income", "Home", "#f59e0b"),
    ("Government Payment", "Income", "Landmark", "#0ea5e9"),
    ("Refund", "Income", "RotateCcw", "#10b981"),
    ("Transfer In", "Income", "ArrowDownLeft", "#64748b"),
    ("Other Income", "Income", "MoreHorizontal", "#6b7280"),
]


async def seed_default_categories(session: AsyncSession) -> int:
    """
    Insert default categories if they don't exist yet.

    Returns the number of new categories inserted.
    """
    # Get existing category names
    result = await session.execute(select(Category.name))
    existing_names = {row[0] for row in result.all()}

    new_count = 0
    for name, cat_type, icon, colour in DEFAULT_CATEGORIES:
        if name not in existing_names:
            session.add(
                Category(
                    name=name,
                    category_type=cat_type,
                    icon=icon,
                    colour=colour,
                    is_system=True,
                )
            )
            new_count += 1

    if new_count > 0:
        await session.commit()
        logger.info("Seeded %d default categories", new_count)
    else:
        logger.info("All default categories already exist — nothing to seed")

    return new_count
