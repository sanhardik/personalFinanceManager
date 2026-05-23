#!/usr/bin/env python3
"""
FinHQ Demo Data Seeder
======================
Populates the database with realistic fake Australian financial data
so you can take a clean screenshot or GIF for the landing page.

WARNING: This DELETES all existing data in your database.
         After taking your screenshot, re-import your real bank CSVs.
         SHA-256 dedup means no duplicate transactions will be created.

Usage (from the backend/ directory):
    python demo_seed.py

Requirements: same venv as the app (already installed).
"""

import asyncio
import hashlib
import os
import sys
from datetime import datetime
from pathlib import Path

# Load .env from backend/
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

# Add backend/ to path so we can import app models
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

# Import all models so SQLAlchemy knows about them for create_all()
import app.models  # noqa: F401  — registers all ORM models
from app.database import Base

# ── Terminal colours ──────────────────────────────────────────────────────────
RED    = "\033[91m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

# ── Database URL (mirrors app/config.py logic) ────────────────────────────────
DB_TYPE = os.getenv("DB_TYPE", "mariadb").lower()
if DB_TYPE == "sqlite":
    db_path = os.getenv("SQLITE_PATH", "finance_app.db")
    DATABASE_URL = f"sqlite+aiosqlite:///{db_path}"
    IS_SQLITE = True
else:
    host     = os.getenv("DB_HOST",     "localhost")
    port     = os.getenv("DB_PORT",     "3306")
    user     = os.getenv("DB_USER",     "finance_user")
    password = os.getenv("DB_PASSWORD", "finance_pass")
    dbname   = os.getenv("DB_NAME",     "finance_app")
    DATABASE_URL = f"mysql+aiomysql://{user}:{password}@{host}:{port}/{dbname}"
    IS_SQLITE = False

# ── Helpers ───────────────────────────────────────────────────────────────────

def d(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day)


def tx_hash(account_id: int, tx_date: datetime, tx_desc: str, tx_amount: float) -> str:
    raw = f"{account_id}|{tx_date.date()}|{tx_desc}|{tx_amount}"
    return hashlib.sha256(raw.encode()).hexdigest()


def stock_hash(account_id: int, trade_date: datetime, code: str, trade_type: str, net: float) -> str:
    raw = f"{account_id}|{trade_date.date()}|{code}|{trade_type}|{net}"
    return hashlib.sha256(raw.encode()).hexdigest()


# ── Demo categories ───────────────────────────────────────────────────────────
# (name, type, colour)
CATEGORIES = [
    # Expenses
    ("Groceries",          "Expense", "#22c55e"),
    ("Dining Out",         "Expense", "#f97316"),
    ("Fuel",               "Expense", "#eab308"),
    ("Utilities",          "Expense", "#3b82f6"),
    ("Phone & Internet",   "Expense", "#8b5cf6"),
    ("Subscriptions",      "Expense", "#ec4899"),
    ("Health & Pharmacy",  "Expense", "#ef4444"),
    ("Childcare",          "Expense", "#f59e0b"),
    ("Shopping",           "Expense", "#06b6d4"),
    ("Insurance",          "Expense", "#7c3aed"),
    ("Home Loan Interest", "Expense", "#64748b"),
    ("Loan Drawdown",      "Expense", "#94a3b8"),
    ("Tax",                "Expense", "#475569"),
    ("Transfer Out",       "Expense", "#9ca3af"),
    # Income
    ("Salary",             "Income",  "#10b981"),
    ("Interest",           "Income",  "#34d399"),
    ("Dividend Income",    "Income",  "#6ee7b7"),
    ("Home Loan Payment",  "Income",  "#64748b"),
    ("Transfer In",        "Income",  "#9ca3af"),
]


# ── Main seeder ───────────────────────────────────────────────────────────────

async def seed(session: AsyncSession) -> None:

    # ── 0. Create tables if they don't exist yet ─────────────────────────────
    print(f"{CYAN}Ensuring all tables exist...{RESET}")
    async with session.bind.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # ── 1. Clear all tables (FK-safe order) ──────────────────────────────────
    print(f"{CYAN}Clearing existing data...{RESET}")
    if IS_SQLITE:
        await session.execute(text("PRAGMA foreign_keys = OFF"))
    else:
        await session.execute(text("SET FOREIGN_KEY_CHECKS = 0"))

    for table in [
        "suggested_rules",
        "stock_valuations",
        "stock_trades",
        "transactions",
        "rules",
        "accounts",
        "assets",
        "categories",
    ]:
        if IS_SQLITE:
            await session.execute(text(f"DELETE FROM `{table}`"))
        else:
            # Only delete if the table actually exists (some may not if app hasn't started)
            r = await session.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.tables "
                    "WHERE table_schema = DATABASE() AND table_name = :t"
                ),
                {"t": table},
            )
            if r.scalar():
                await session.execute(text(f"DELETE FROM `{table}`"))
            else:
                print(f"  (skipping {table} — table not yet created)")

    if IS_SQLITE:
        await session.execute(text("PRAGMA foreign_keys = ON"))
    else:
        await session.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
    await session.commit()

    # ── 2. Categories ─────────────────────────────────────────────────────────
    print(f"{CYAN}Seeding categories...{RESET}")
    cat_ids: dict[str, int] = {}
    for name, cat_type, colour in CATEGORIES:
        r = await session.execute(
            text(
                "INSERT INTO categories (name, category_type, colour, is_system) "
                "VALUES (:n, :t, :c, 1)"
            ),
            {"n": name, "t": cat_type, "c": colour},
        )
        cat_ids[name] = r.lastrowid
    await session.commit()

    # ── 3. Asset ──────────────────────────────────────────────────────────────
    print(f"{CYAN}Seeding asset...{RESET}")
    r = await session.execute(
        text(
            "INSERT INTO assets "
            "(asset_name, asset_type, address_street, address_suburb, address_state, "
            "address_postcode, purchase_price, purchase_date, current_value, "
            "current_value_at, is_rental) "
            "VALUES (:n, 'property', :st, :sub, 'NSW', '2148', :pp, :pd, :cv, :cva, 0)"
        ),
        {
            "n":   "Demo Family Home",
            "st":  "1 Demo Street",
            "sub": "Greenfield",
            "pp":  750_000.0,
            "pd":  d(2021, 6, 15),
            "cv":  840_000.0,
            "cva": d(2026, 1, 1),
        },
    )
    asset_id = r.lastrowid
    await session.commit()

    # ── 4. Accounts ───────────────────────────────────────────────────────────
    print(f"{CYAN}Seeding accounts...{RESET}")

    r = await session.execute(
        text(
            "INSERT INTO accounts (account_number, account_name, bank_name, account_type, is_active) "
            "VALUES ('032-DEMO-001', 'Demo Everyday Account', 'Westpac', 'bank', 1)"
        )
    )
    westpac_id = r.lastrowid

    r = await session.execute(
        text(
            "INSERT INTO accounts (account_number, account_name, bank_name, account_type, is_active) "
            "VALUES ('MAC-DEMO-SAVINGS', 'Demo Savings Account', 'Macquarie', 'bank', 1)"
        )
    )
    mac_savings_id = r.lastrowid

    r = await session.execute(
        text(
            "INSERT INTO accounts "
            "(account_number, account_name, bank_name, account_type, is_active, "
            " asset_id, loan_original_amount, loan_interest_rate, loan_start_date, "
            " loan_term_years, loan_repayment_type) "
            "VALUES ('MAC-DEMO-LOAN', 'Demo Home Loan', 'Macquarie', 'home_loan', 1, "
            " :aid, 600000.0, 6.24, :lsd, 30, 'principal_and_interest')"
        ),
        {"aid": asset_id, "lsd": d(2021, 6, 30)},
    )
    loan_id = r.lastrowid

    r = await session.execute(
        text(
            "INSERT INTO accounts (account_number, account_name, bank_name, account_type, is_active) "
            "VALUES ('SH-DEMO-001', 'Demo Investment Portfolio', 'Superhero', 'investment', 1)"
        )
    )
    superhero_id = r.lastrowid

    await session.commit()

    # ── 5. Transactions — Westpac everyday ───────────────────────────────────
    print(f"{CYAN}Seeding Westpac transactions (3 months)...{RESET}")

    def w(dt, desc, amount, tx_type, cat):
        return dict(
            account_id   = westpac_id,
            category_id  = cat_ids.get(cat),
            tx_date      = dt,
            tx_desc      = desc,
            tx_amount    = abs(amount),
            tx_type      = tx_type,
            tx_hash      = tx_hash(westpac_id, dt, desc, abs(amount)),
            balance      = None,
            is_categorised = cat is not None,
        )

    westpac_txs = [
        # ── January 2026 ─────────────────────────────────────────────────────
        w(d(2026,1,15), "SALARY ACME TECH PTY LTD",            8200.00, "Income",  "Salary"),
        w(d(2026,1, 3), "WOOLWORTHS 4521 GREENFIELD",            187.40, "Expense", "Groceries"),
        w(d(2026,1,10), "WOOLWORTHS 4521 GREENFIELD",            163.20, "Expense", "Groceries"),
        w(d(2026,1,17), "COLES GREENFIELD",                      142.80, "Expense", "Groceries"),
        w(d(2026,1,24), "COLES GREENFIELD",                      198.60, "Expense", "Groceries"),
        w(d(2026,1, 5), "BP FUEL GREENFIELD",                     82.50, "Expense", "Fuel"),
        w(d(2026,1,19), "SHELL RIVERSIDE",                        75.30, "Expense", "Fuel"),
        w(d(2026,1, 8), "MCDONALDS GREENFIELD",                   24.50, "Expense", "Dining Out"),
        w(d(2026,1,12), "PASTA PALACE GREENFIELD",                87.00, "Expense", "Dining Out"),
        w(d(2026,1,20), "STARBUCKS GREENFIELD",                   15.40, "Expense", "Dining Out"),
        w(d(2026,1,25), "NANDOS RIVERSIDE",                       42.80, "Expense", "Dining Out"),
        w(d(2026,1, 6), "OPTUS MOBILE MONTHLY",                   89.00, "Expense", "Phone & Internet"),
        w(d(2026,1,10), "NETFLIX SUBSCRIPTION",                   22.99, "Expense", "Subscriptions"),
        w(d(2026,1,10), "SPOTIFY PREMIUM",                        13.99, "Expense", "Subscriptions"),
        w(d(2026,1,20), "ORIGIN ENERGY",                         245.00, "Expense", "Utilities"),
        w(d(2026,1,22), "SYDNEY WATER CORP",                     180.00, "Expense", "Utilities"),
        w(d(2026,1, 8), "CHEMIST WAREHOUSE GREENFIELD",           38.50, "Expense", "Health & Pharmacy"),
        w(d(2026,1,15), "BRIGHT FUTURES CHILDCARE",              485.00, "Expense", "Childcare"),
        w(d(2026,1,25), "KMART GREENFIELD",                       67.30, "Expense", "Shopping"),
        w(d(2026,1,28), "JB HI-FI RIVERSIDE",                   249.00, "Expense", "Shopping"),
        w(d(2026,1,18), "NRMA INSURANCE",                        198.00, "Expense", "Insurance"),
        # ── February 2026 ────────────────────────────────────────────────────
        w(d(2026,2,15), "SALARY ACME TECH PTY LTD",            8200.00, "Income",  "Salary"),
        w(d(2026,2, 2), "WOOLWORTHS 4521 GREENFIELD",            172.80, "Expense", "Groceries"),
        w(d(2026,2, 9), "ALDI GREENFIELD",                        94.50, "Expense", "Groceries"),
        w(d(2026,2,16), "COLES GREENFIELD",                      158.30, "Expense", "Groceries"),
        w(d(2026,2,23), "WOOLWORTHS 4521 GREENFIELD",            201.70, "Expense", "Groceries"),
        w(d(2026,2, 4), "BP FUEL GREENFIELD",                     88.20, "Expense", "Fuel"),
        w(d(2026,2,18), "7-ELEVEN RIVERSIDE",                     71.40, "Expense", "Fuel"),
        w(d(2026,2, 7), "GUZMAN Y GOMEZ GREENFIELD",              28.90, "Expense", "Dining Out"),
        w(d(2026,2,14), "RIVERSIDE THAI RESTAURANT",              96.00, "Expense", "Dining Out"),
        w(d(2026,2,21), "COFFEE CLUB GREENFIELD",                 18.60, "Expense", "Dining Out"),
        w(d(2026,2, 6), "OPTUS MOBILE MONTHLY",                   89.00, "Expense", "Phone & Internet"),
        w(d(2026,2,10), "NETFLIX SUBSCRIPTION",                   22.99, "Expense", "Subscriptions"),
        w(d(2026,2,10), "SPOTIFY PREMIUM",                        13.99, "Expense", "Subscriptions"),
        w(d(2026,2,20), "AGL ENERGY",                            231.00, "Expense", "Utilities"),
        w(d(2026,2,15), "BRIGHT FUTURES CHILDCARE",              485.00, "Expense", "Childcare"),
        w(d(2026,2,11), "PRICELINE PHARMACY GREENFIELD",          52.40, "Expense", "Health & Pharmacy"),
        w(d(2026,2,20), "TARGET RIVERSIDE",                       89.90, "Expense", "Shopping"),
        w(d(2026,2,18), "NRMA INSURANCE",                        198.00, "Expense", "Insurance"),
        # ── March 2026 ───────────────────────────────────────────────────────
        w(d(2026,3,15), "SALARY ACME TECH PTY LTD",            8200.00, "Income",  "Salary"),
        w(d(2026,3, 2), "WOOLWORTHS 4521 GREENFIELD",            193.60, "Expense", "Groceries"),
        w(d(2026,3, 9), "COLES GREENFIELD",                      147.20, "Expense", "Groceries"),
        w(d(2026,3,16), "ALDI GREENFIELD",                        88.40, "Expense", "Groceries"),
        w(d(2026,3,23), "WOOLWORTHS 4521 GREENFIELD",            211.30, "Expense", "Groceries"),
        w(d(2026,3, 5), "BP FUEL GREENFIELD",                     79.80, "Expense", "Fuel"),
        w(d(2026,3,20), "SHELL RIVERSIDE",                        84.60, "Expense", "Fuel"),
        w(d(2026,3, 7), "MCDONALDS GREENFIELD",                   31.20, "Expense", "Dining Out"),
        w(d(2026,3,13), "THE ITALIAN PLACE GREENFIELD",          112.00, "Expense", "Dining Out"),
        w(d(2026,3,22), "COFFEE CLUB GREENFIELD",                 14.80, "Expense", "Dining Out"),
        w(d(2026,3,28), "SUSHI TRAIN GREENFIELD",                 52.40, "Expense", "Dining Out"),
        w(d(2026,3, 6), "OPTUS MOBILE MONTHLY",                   89.00, "Expense", "Phone & Internet"),
        w(d(2026,3,10), "NETFLIX SUBSCRIPTION",                   22.99, "Expense", "Subscriptions"),
        w(d(2026,3,10), "SPOTIFY PREMIUM",                        13.99, "Expense", "Subscriptions"),
        w(d(2026,3,20), "ORIGIN ENERGY",                         238.00, "Expense", "Utilities"),
        w(d(2026,3,22), "SYDNEY WATER CORP",                     175.00, "Expense", "Utilities"),
        w(d(2026,3,15), "BRIGHT FUTURES CHILDCARE",              485.00, "Expense", "Childcare"),
        w(d(2026,3, 8), "CHEMIST WAREHOUSE GREENFIELD",           44.20, "Expense", "Health & Pharmacy"),
        w(d(2026,3,25), "BUNNINGS WAREHOUSE RIVERSIDE",          187.40, "Expense", "Shopping"),
        w(d(2026,3,18), "NRMA INSURANCE",                        198.00, "Expense", "Insurance"),
    ]

    insert_tx = text(
        "INSERT INTO transactions "
        "(account_id, category_id, tx_date, tx_desc, tx_amount, tx_type, tx_hash, balance, is_categorised) "
        "VALUES (:account_id, :category_id, :tx_date, :tx_desc, :tx_amount, :tx_type, :tx_hash, :balance, :is_categorised)"
    )
    for tx in westpac_txs:
        await session.execute(insert_tx, tx)

    # ── 6. Transactions — Macquarie savings ──────────────────────────────────
    print(f"{CYAN}Seeding Macquarie savings transactions...{RESET}")

    def m(dt, desc, amount, tx_type, cat, bal=None):
        return dict(
            account_id   = mac_savings_id,
            category_id  = cat_ids.get(cat),
            tx_date      = dt,
            tx_desc      = desc,
            tx_amount    = abs(amount),
            tx_type      = tx_type,
            tx_hash      = tx_hash(mac_savings_id, dt, desc, abs(amount)),
            balance      = bal,
            is_categorised = cat is not None,
        )

    mac_txs = [
        m(d(2026,1,31), "Payment",                       48.20, "Income",  "Interest",   32_480.20),
        m(d(2026,1,31), "TFN withholding tax deduction", 22.00, "Expense", "Tax",         32_458.20),
        m(d(2026,2,28), "Payment",                       41.30, "Income",  "Interest",   32_499.50),
        m(d(2026,2,28), "TFN withholding tax deduction", 19.00, "Expense", "Tax",         32_480.50),
        m(d(2026,3,31), "Payment",                       52.10, "Income",  "Interest",   32_532.60),
        m(d(2026,3,31), "TFN withholding tax deduction", 24.00, "Expense", "Tax",         32_508.60),
    ]
    for tx in mac_txs:
        await session.execute(insert_tx, tx)

    # ── 7. Transactions — Home loan ───────────────────────────────────────────
    print(f"{CYAN}Seeding home loan transactions...{RESET}")

    def ln(dt, desc, amount, tx_type, cat, bal=None):
        return dict(
            account_id   = loan_id,
            category_id  = cat_ids.get(cat),
            tx_date      = dt,
            tx_desc      = desc,
            tx_amount    = abs(amount),
            tx_type      = tx_type,
            tx_hash      = tx_hash(loan_id, dt, desc, abs(amount)),
            balance      = bal,
            is_categorised = cat is not None,
        )

    loan_txs = [
        # Initial drawdown
        ln(d(2021, 6,30), "Loan drawdown",     600_000.00, "Expense", "Loan Drawdown",      -600_000.00),
        # 6 months of repayment history — enough for the chart
        ln(d(2025,10,18), "From Main account",   3_100.00, "Income",  "Home Loan Payment",  -578_420.30),
        ln(d(2025,10,18), "Interest Charged",    2_981.40, "Expense", "Home Loan Interest", -581_401.70),
        ln(d(2025,11,18), "From Main account",   3_100.00, "Income",  "Home Loan Payment",  -578_301.70),
        ln(d(2025,11,18), "Interest Charged",    2_976.20, "Expense", "Home Loan Interest", -581_277.90),
        ln(d(2025,12,18), "From Main account",   3_100.00, "Income",  "Home Loan Payment",  -578_177.90),
        ln(d(2025,12,18), "Interest Charged",    2_970.90, "Expense", "Home Loan Interest", -581_148.80),
        ln(d(2026, 1,18), "From Main account",   3_100.00, "Income",  "Home Loan Payment",  -578_048.80),
        ln(d(2026, 1,18), "Interest Charged",    2_965.50, "Expense", "Home Loan Interest", -581_014.30),
        ln(d(2026, 2,18), "From Main account",   3_100.00, "Income",  "Home Loan Payment",  -577_914.30),
        ln(d(2026, 2,18), "Interest Charged",    2_960.10, "Expense", "Home Loan Interest", -580_874.40),
        ln(d(2026, 3,18), "From Main account",   3_100.00, "Income",  "Home Loan Payment",  -577_774.40),
        ln(d(2026, 3,18), "Interest Charged",    2_954.70, "Expense", "Home Loan Interest", -580_729.10),
    ]
    for tx in loan_txs:
        await session.execute(insert_tx, tx)

    await session.commit()

    # ── 8. Stock trades ───────────────────────────────────────────────────────
    print(f"{CYAN}Seeding stock trades...{RESET}")

    def stk(dt, name, code, trade_type, qty, price, net, brok=0.0):
        return dict(
            account_id     = superhero_id,
            trade_date     = dt,
            settlement_date = None,
            security_name  = name,
            security_code  = code,
            trade_type     = trade_type,
            quantity       = qty,
            avg_price      = price,
            net_amount     = net,
            brokerage      = brok,
            gst            = round(brok * 0.1, 2),
            tax            = 0.0,
            trade_hash     = stock_hash(superhero_id, dt, code, trade_type, net),
        )

    trades = [
        stk(d(2025, 7, 2),  "Vanguard Australian Shares Index ETF",             "VAS", "Buy",              10, 102.40, -1_024.00, 2.0),
        stk(d(2025, 7,15),  "Vanguard MSCI Index International Shares ETF",     "VGS", "Buy",               5, 148.20,   -741.00, 2.0),
        stk(d(2025, 8, 5),  "iShares S&P 500 ETF",                              "IVV", "Buy",               2,  63.80,   -127.60, 0.0),
        stk(d(2025, 9,10),  "Vanguard Australian Shares Index ETF",             "VAS", "Buy",               5, 105.60,   -528.00, 2.0),
        stk(d(2025,10, 1),  "Vanguard Australian Shares Index ETF",             "VAS", "Dividend Received", None, None,   47.30, 0.0),
        stk(d(2025,11, 3),  "Vanguard MSCI Index International Shares ETF",     "VGS", "Buy",               3, 152.40,   -457.20, 2.0),
        stk(d(2025,12,15),  "iShares S&P 500 ETF",                              "IVV", "Buy",               3,  67.50,   -202.50, 0.0),
        stk(d(2026, 1, 1),  "Vanguard Australian Shares Index ETF",             "VAS", "Dividend Received", None, None,   52.80, 0.0),
        stk(d(2026, 1,20),  "Vanguard Australian Shares Index ETF",             "VAS", "Buy",               5, 108.90,   -544.50, 2.0),
        stk(d(2026, 2,10),  "Vanguard MSCI Index International Shares ETF",     "VGS", "Buy",               2, 157.30,   -314.60, 2.0),
    ]

    insert_stk = text(
        "INSERT INTO stock_trades "
        "(account_id, trade_date, settlement_date, security_name, security_code, "
        " trade_type, quantity, avg_price, net_amount, brokerage, gst, tax, trade_hash) "
        "VALUES (:account_id, :trade_date, :settlement_date, :security_name, :security_code, "
        "        :trade_type, :quantity, :avg_price, :net_amount, :brokerage, :gst, :tax, :trade_hash)"
    )
    for t in trades:
        await session.execute(insert_stk, t)

    # ── 9. Stock valuations (current prices) ──────────────────────────────────
    valuations = [
        {"account_id": superhero_id, "security_code": "VAS", "price": 114.20, "valuation_date": d(2026,3,20)},
        {"account_id": superhero_id, "security_code": "VGS", "price": 163.40, "valuation_date": d(2026,3,20)},
        {"account_id": superhero_id, "security_code": "IVV", "price":  71.80, "valuation_date": d(2026,3,20)},
    ]
    for v in valuations:
        await session.execute(
            text(
                "INSERT INTO stock_valuations (account_id, security_code, price, valuation_date) "
                "VALUES (:account_id, :security_code, :price, :valuation_date)"
            ),
            v,
        )

    await session.commit()

    # ── Done ──────────────────────────────────────────────────────────────────
    print(f"""
{GREEN}{BOLD}✅  Demo data loaded successfully!{RESET}

{CYAN}What was created:{RESET}
  Accounts  : Westpac Everyday · Macquarie Savings · Macquarie Home Loan · Superhero Portfolio
  Asset     : Demo Family Home — $750k purchase / $840k current value
  Westpac   : {len(westpac_txs)} transactions across Jan–Mar 2026
              Salary · Groceries · Fuel · Dining Out · Childcare · Utilities
              Phone · Subscriptions · Health · Shopping · Insurance
  Macquarie : {len(mac_txs)} savings transactions (interest income + TFN withholding)
  Home loan : {len(loan_txs)} transactions — drawdown + 6 months of repayments
  Stocks    : {len(trades)} trades (VAS, VGS, IVV) + 3 current price valuations

{YELLOW}👉  Next steps:{RESET}
  1. Start the app:     cd ..  &&  python3 start.py
  2. Open the dashboard (http://localhost:8000)
  3. Take your screenshot or GIF
  4. Set the date range to Jan 2026 – Mar 2026 for the best charts

{YELLOW}⚠️   To restore your real data:{RESET}
  Re-upload your bank CSVs from the Upload page.
  SHA-256 dedup means no duplicate transactions will be created.
""")


# ── Entry point ───────────────────────────────────────────────────────────────

async def main() -> None:
    print(f"""
{RED}{BOLD}╔══════════════════════════════════════════════════════╗
║        FinHQ Demo Data Seeder — WARNING              ║
╚══════════════════════════════════════════════════════╝{RESET}
{YELLOW}This will DELETE all data in your FinHQ database and
replace it with fake demo data for screenshots/demos.

Your real financial data will be erased from the DB.
You can restore it afterwards by re-uploading your CSVs.{RESET}
""")
    answer = input(f"{BOLD}Type  yes  to continue, anything else to abort: {RESET}").strip().lower()
    if answer != "yes":
        print(f"\n{GREEN}Aborted. Your data is safe.{RESET}\n")
        sys.exit(0)

    print()
    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        await seed(session)

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
