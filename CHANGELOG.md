# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-05-21

Initial public release. Everything listed here was built and tested before the repo was made public.

### Added

**Bank CSV Parsers**
- Westpac parser — supports bank accounts and credit cards; handles separate debit/credit columns; DD/MM/YYYY date format
- NAB parser — signed single Amount column; DD Mon YY date format; auto-detects account number from CSV
- Macquarie parser — two-pass loan detection; supports savings accounts and home loan accounts from the same export; derives account slug when no account number is present
- Superhero Transaction Statement parser — stock buys, sells, and dividend rows; strips `$` prefix from amounts; metadata block extraction
- Superhero Cash Statement parser — AUD cash account deposits and FX transfers; skips stock purchase and dividend rows already captured in Transaction Statement
- Pluggable `BankParser` ABC — all parsers implement a common interface; auto-detection via `detect_parser(header)` in registry

**Transaction Management**
- SHA-256 deduplication — re-uploading the same CSV is always safe
- 50+ default Australian spending categories seeded on first run (25 Expense + 8 Income)
- Parent/child category hierarchy (e.g. Children → Childcare, Education)
- Inline manual categorisation with click-to-edit
- Bulk categorisation — apply a category to all similar transactions at once
- Transfer linking — auto-matches internal transfers between accounts (same amount, date ±2 days)

**Rules Engine**
- Pattern-based auto-categorisation (e.g. `COLES` → Groceries)
- 50+ default Australian merchant rules seeded on first run
- Rule learning — suggests new rules after manual categorisations (Option A: banner prompt; Option B: auto-promote at 3 hits; Option C: Suggested Rules panel)
- Rule management page — create, edit, delete, test-apply, recategorise

**Dashboard & Reports**
- Date range picker (default: last 3 months)
- Summary cards: Income, Expenses, Net Savings, Uncategorised count
- Monthly ComposedChart: Income + Expenses bars + Savings line
- Spending by Category horizontal bar chart (top 14, coloured per category)
- Income by Category horizontal bar chart
- Transfers excluded from all dashboard figures

**Home Loan & Asset Tracking**
- Assets page — property, equity, and stock portfolio asset types
- Loans page — current balance, % paid progress bar, interest rate, projected payoff date, payment history chart (interest vs principal stacked), LVR and equity panel
- Loan accounts auto-detected from Macquarie CSV exports
- Three-step upload flow: detect → assign accounts → import

**Stock Portfolio (Superhero)**
- Holdings table: quantity, average cost, cost basis, current value (inline price editor), unrealised gain, dividends, total return %, annualised return (ARR)
- ⚡ badge for positions held less than 1 year (IRR not meaningful)
- Expandable trades sub-table per security
- Sector donut chart (cost basis), dividend timeline (stacked bar), cumulative cost basis line chart

**Infrastructure**
- FastAPI + async SQLAlchemy + aiomysql backend
- React 19 + Vite + Recharts + Tailwind frontend
- MariaDB via Docker Compose (port 3306 dev, 3307 test)
- SQLite option for users without Docker
- Separate test database with tmpfs RAM storage — fast, isolated
- 233 backend tests across 15 test files (all passing at release)
- GitHub Actions CI: pytest + MariaDB service container on every PR
- `run.sh` script with tmux-based service management

---

## [Unreleased]

### Planned

- Simply Wall St integration for stock data enrichment
- Budget goals and spending limits
- Investment property rental income tracking
- Multi-currency support
- Additional bank parsers (community contributions welcome)

---

[1.0.0]: https://github.com/sanhardik/personalFinanceManager/releases/tag/v1.0.0
