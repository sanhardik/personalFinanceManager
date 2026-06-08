# Memory

## Me
Hardik Sanghavi (hardik.sanghavi@permaconn.com). Building a personal finance manager to track bank transactions, stocks (Simply Wall St), and investment properties. Runs locally on Mac.

## Terms
| Term | Meaning |
|------|---------|
| SWS | Simply Wall St — stock portfolio tracking platform |
| Cowork | Claude desktop AI tool — handles batch ingestion + categorisation |
| PFM | Personal Finance Manager — this project |
| Phase 1 | Bank CSV ingestion + transaction categorisation + dashboard |
| v1 / old code | Existing Flask + MariaDB app in /src/ |
| finance-app | New codebase folder for Phase 1 rebuild |

## Project — Personal Finance Manager
| Key | Value |
|-----|-------|
| Location | `FinancePortfolioManager/finance-app/` |
| Old code | `FinancePortfolioManager/src/` (Flask, keep untouched) |
| Backend | Python FastAPI + async SQLAlchemy + aiomysql |
| Frontend | React (Vite + Recharts + Tailwind), light theme |
| Database | MariaDB on port 3306, database name `finance_app` |
| Docker | New docker-compose in `finance-app/` |
| Auth | None (local single-user) |
| AI approach | Cowork handles categorisation (no Claude API spend) |
| Banks | Westpac, NAB, Macquarie — CSV upload |
| Stocks | Simply Wall St (future phase) |
| Properties | Investment properties (future phase) |

## Architecture Decisions
- Pluggable bank parser system (ABC base class per bank)
- Async SQLAlchemy with aiomysql for FastAPI
- Rule-based categorisation in-app; Cowork for batch AI categorisation externally
- FastAPI serves data to React (no AI in API layer)
- **API routing**: All FastAPI routers mounted under `prefix="/api"` in `main.py`. Vite proxy forwards `/api/*` to backend WITHOUT stripping prefix (no rewrite). Both dev and prod use `/api/*` paths.
- CORS: backend 8000, frontend 5173. `http://localhost:5173` hardcoded in `allow_origins` in addition to `settings.FRONTEND_URL` so tests always pass.
- Dedup via SHA256 hash of (account_id + tx_date + tx_desc + tx_amount)
- **Test client**: `_ApiClient` wrapper in `conftest.py` prepends `/api` to all requests so tests hit FastAPI via ASGI transport without needing a proxy.

## Testing
- **Test DB**: Separate MariaDB container on port 3307 (`docker-compose.test.yml`)
  - Container: `finance-db-test` | DB: `finance_app_test` | User: `finance_test_user`
  - Uses `tmpfs` for RAM-backed storage (fast, disposable)
  - Config: `backend/.env.test`
- **Test runner**: pytest with `conftest.py` that overrides `get_db` dependency
  - Tables dropped + recreated at start of each test session
  - Default categories seeded automatically
  - Clear error message if test DB is not running
- **Run tests**: `./run.sh test` (auto-starts test DB if needed)
- **Watch mode**: `./run.sh test-watch` (re-runs on every .py file save)
- **Logs**: All services log to `logs/` directory; `./run.sh logs test` shows last test run

## Banks — CSV Formats
| Bank | Date Format | Columns | Notes |
|------|-------------|---------|-------|
| Westpac | DD/MM/YYYY | Bank Account, Date, Narrative, Debit Amount, Credit Amount | Separate debit/credit cols; credit card detection by account prefix |
| NAB | DD Mon YY | Date, Amount, Account Number, (blank), Transaction Type, Transaction Details, Balance, Category, Merchant Name, Processed On | Single signed Amount col; neg=expense, pos=income; blank 4th col |
| Macquarie | TBD | TBD | Blocked — no sample CSV yet |

## Build Plan — Phase 1 Chunks
| Chunk | What | Status |
|-------|------|--------|
| 1 | Skeleton: Docker + FastAPI + React + CLAUDE.md + memory | Done |
| 2 | Database models + seed categories + Categories page | Done |
| 3 | Westpac CSV parser + upload + Transactions table | Done |
| 4 | Transaction filters + search + pagination | Done |
| 5 | Rules + manual categorisation + PATCH /transactions | Done |
| 6 | Dashboard + Reports (charts, net worth, recent txns) | Done |
| 7 | NAB parser + auto-detection | Done |
| 8 | Macquarie parser | Done |
| 9 | Home Loan Tracking — Assets, Loans pages, loan CSV detection, upload flow | Done |
| 10 | Superhero CSV ingestion — stock trades, holdings, P&L analytics, ARR | Done |
| 11 | Open source release — production routing fix, CI, GitHub Pages landing page | Done |

## Chunk 1 — What Was Built (DONE)
### Backend (Python FastAPI)
- `app/main.py` — FastAPI app with /health endpoint and lifespan events
- `app/config.py` — Pydantic settings from .env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME)
- `app/database.py` — Async SQLAlchemy engine, session factory, get_db dependency, health check
- `docker-compose.yml` — MariaDB 10.11 on port 3306, phpMyAdmin 5.2.3 on 8080 (platform: linux/amd64 for Apple Silicon)
- `backend/.env` — DB credentials (finance_user / finance_pass / finance_app)
- Empty package dirs: routers/, parsers/, services/, utils/

### Frontend (React + Vite)
- Vite 6.4.1, @vitejs/plugin-react 5.2.0, React 19, React Router 7, Tailwind 4
- `App.jsx` — React Router v7 with nested Layout route
- `api/client.js` — Axios instance with /api proxy (Vite rewrites /api/* → localhost:8000/*)
- `api/health.js` — Fetches /health endpoint
- `components/Layout/Layout.jsx` — Sidebar + Header + Outlet wrapper
- `components/Layout/Sidebar.jsx` — NavLink navigation (Dashboard, Transactions, Categories, Rules, Upload, Settings)
- `components/Layout/Header.jsx` — Health status badge (green/red) + version display, polls every 30s
- `pages/*.jsx` — Placeholder pages for Dashboard, Transactions, Categories, Rules, UploadCSV, Settings

### Tests
- `tests/conftest.py` — httpx AsyncClient fixture via ASGI transport
- `tests/test_health.py` — 5 tests: health returns 200, has version, status ok/degraded, CORS headers, 404 for unknown routes

### Infrastructure
- `run.sh` — Bash script with tmux-based service management
- `.cursorrules` — Project rules for Cursor IDE
- `.cursorignore` — Excludes node_modules, venv, dist, __pycache__

## Chunk 2 — What Was Built (DONE)
### Backend
- `app/models.py` — SQLAlchemy ORM models: Account, Category, Transaction, Rule
  - Account: account_number (unique), account_name, bank_name, is_active
  - Category: name (unique), category_type (Income/Expense), icon, colour, is_system
  - Transaction: account_id FK, category_id FK, tx_date, tx_desc, tx_amount, tx_type, tx_hash (SHA256 dedup), is_categorised
  - Rule: pattern, category_id FK, is_active
- `app/schemas.py` — Pydantic schemas: CategoryCreate, CategoryUpdate, CategoryResponse, AccountResponse, TransactionResponse
- `app/routers/categories.py` — Full CRUD: GET (list + filter), POST (create + dedup), GET/{id}, PUT/{id}, DELETE/{id} (blocks system categories)
- `app/services/seed.py` — 33 default Australian categories (25 Expense + 8 Income), seeded on startup, idempotent
- `app/main.py` — Updated with model imports, category router, seed on startup

### Frontend
- `src/api/categories.js` — API client functions (fetchCategories, createCategory, updateCategory, deleteCategory)
- `src/pages/Categories.jsx` — Full category management page: list table with colour dots + type badges, filter tabs (All/Income/Expense), inline create form, inline edit, delete with confirmation, system category protection

### Tests (22 total — all passing)
- `tests/conftest.py` — Updated with in-memory SQLite (aiosqlite) test fixtures, dependency override for get_db, auto-seed categories
- `tests/test_categories.py` — 17 tests: list, filter by type, invalid filter, create, create income, duplicate 409, empty name 422, invalid type 422, get by id, get 404, update, delete, delete system 403, delete 404, response shape
- `tests/test_health.py` — 5 existing tests (unchanged, all passing)

### Dependencies Added
- `aiosqlite==0.22.0` in requirements.txt (testing only)

## Chunk 3 — What Was Built (DONE)
### Backend
- `app/parsers/base.py` — Abstract `BankParser` base class + `ParsedTransaction` / `ParseResult` dataclasses
- `app/parsers/registry.py` — `detect_parser(header)` auto-detects bank from CSV header; `get_supported_banks()`
- `app/parsers/westpac.py` — Westpac CSV parser: DD/MM/YYYY dates, debit/credit cols, credit card vs bank account detection
- `app/services/upload.py` — Orchestrates parse → account upsert → transaction insert with SHA256 dedup
- `app/routers/upload.py` — `POST /upload` (file), `GET /upload/banks`
- `app/routers/accounts.py` — `GET /accounts`, `POST /accounts`, `GET /accounts/summary`, `GET/PUT /accounts/{id}`
- `app/models.py` — Updated `Account` (account_type: bank/credit_card/home_loan, linked_account_id), `Transaction` (balance, original_category)
- `app/schemas.py` — Added `AccountCreate`, `AccountUpdate`, `UploadResponse`

### Frontend
- `src/api/accounts.js` — `fetchAccounts`, `fetchAccountsSummary`, `createAccount`, `updateAccount`
- `src/api/transactions.js` — `fetchTransactions({accountId, txType, search, sortBy, sortDir, page, perPage})`
- `src/api/upload.js` — `uploadCSV(file)`, `fetchSupportedBanks()`
- `src/pages/Accounts.jsx` — Accounts list grouped by bank, create/edit inline, account type badges
- `src/pages/Transactions.jsx` — Table with AUD formatting, category status column
- `src/pages/UploadCSV.jsx` — Drag-drop upload, result display (inserted/duplicates/accounts found)

### Tests (35 total — all passing)
- `tests/test_westpac_parser.py` — 16 unit tests: header detection, expense/income, dates, account types, edge cases
- `tests/test_upload.py` — 13 integration tests: upload, dedup, account creation, account summary, transactions list
- `tests/conftest.py` — Updated to real MariaDB on port 3307; `NullPool` to avoid event loop issues; `truncate_data` autouse fixture for test isolation

## Chunk 5 — What Was Built (DONE)
### Backend
- `app/services/categoriser.py` — `apply_rules_to_transactions()`: case-insensitive pattern matching, first rule wins, applies to uncategorised transactions
- `app/routers/rules.py` — CRUD + `POST /rules/apply` + `GET /rules/{id}/affected` + `POST /rules/{id}/recategorise` + suggestion endpoints
  - `GET /rules/suggestions` — pending rule suggestions sorted by hit_count DESC
  - `POST /rules/suggestions/{id}/accept` — promote suggestion to real rule
  - `POST /rules/suggestions/{id}/dismiss` — mark as dismissed
- `app/routers/transactions.py` — `PATCH /transactions/{id}` for manual category override; `POST /transactions/bulk-categorise`; rule learning after every PATCH
- `app/schemas.py` — Full schemas: Rules, Transactions, `SuggestedRuleHint`, `SuggestedRuleResponse`
- `app/services/seed.py` — `seed_default_rules()` with 50+ Australian merchant patterns
- `app/services/pattern_extractor.py` — Extracts merchant pattern from tx_desc (first meaningful uppercase token ≥3 chars, skipping boilerplate)
- `app/models.py` — Added `SuggestedRule` model (pattern, category_id, hit_count, status, source_tx_ids, promoted_rule_id)
- `app/services/upload.py` — Auto-applies rules after every upload

### Rule Learning System (Options A, B, C)
- **Option A** — After PATCH, backend extracts pattern + upserts `suggested_rules`; PATCH response includes `rule_suggestion` hint; frontend shows purple "Create rule?" banner
- **Option B** — When `hit_count >= 3`, suggestion auto-promoted to real rule; frontend shows green "Rule auto-created" toast
- **Option C** — Violet "Suggested Rules" panel at top of Rules page; shows pending suggestions with hit count; Accept/Dismiss per-row buttons

### DB Migration (applied to dev DB)
- `ALTER TABLE accounts ADD COLUMN account_type, linked_account_id` (were missing post-Chunk 3)
- `ALTER TABLE transactions ADD COLUMN balance, original_category` (same issue)
- `suggested_rules` table auto-created by `create_all()` on next startup (no migration needed)

### Frontend
- `src/api/rules.js` — Added `fetchSuggestions`, `acceptSuggestion`, `dismissSuggestion`
- `src/api/transactions.js` — Added `patchTransaction`, `bulkCategorise`
- `src/pages/Rules.jsx` — Full rules management + recategorise confirmation panel + search + Option C suggestions panel
- `src/pages/Transactions.jsx` — Category column inline edit + similar-tx bulk-apply banner + Option A rule suggestion prompt
- `src/pages/Categories.jsx` — Colour picker, parent categories, hierarchy display
- `src/utils/categoryGroups.js` — `groupCategories()`, `CategoryOptions` component for grouped `<optgroup>` dropdowns

### Tests (73 passed, 5 skipped — all green)
- `tests/test_rules.py` — 14 tests: CRUD, apply, affected, recategorise, PATCH transaction
- `tests/test_suggestions.py` — 15 tests: pattern extractor unit tests, suggestion lifecycle, accept/dismiss

## Additional Features (built across sessions, outside chunks)

### Sorting
- `src/components/SortableHeader.jsx` — drop-in `<th>` replacement; props: `label`, `column`, `sort`, `onSort`, `align`
- `src/hooks/useSortable.js` — manages `{ column, dir }` state + `sortData()` for client-side sorting
- **Transactions** — server-side sort via `sort_by` + `sort_dir` query params; supported cols: `tx_date`, `tx_amount`, `tx_desc`, `tx_type`
- **Categories + Rules** — client-side sort
- **Bug note:** sort handlers must pass `onSort` directly (not wrap with inline `loadTransactions(1)` — causes stale-closure race condition)

### Transfer Auto-Matching
- `transfer_account_id` nullable FK on `transactions` table (added via startup migration)
- When PATCH sets Transfer category + `transfer_account_id`, backend auto-finds the counterpart transaction on the other account (same amount, date ±2 days) and sets the opposite Transfer category + links back
- Frontend shows teal "Matched" banner for 5s when a counterpart is found
- Category select shows account picker (`→ which account?`) when Transfer In/Out is selected

### Startup Migration Pattern
- `information_schema.COLUMNS` check + `ALTER TABLE` for columns `create_all()` can't add to existing tables
- Applied to: `transfer_account_id` on transactions

### README.md
- Created at repo root — covers features, tech stack, project structure, getting started, API overview, roadmap

## Chunk 7 — What Was Built (DONE)
### NAB CSV Format
| Column | Notes |
|--------|-------|
| Date | `DD Mon YY` (e.g. `10 Apr 26`) |
| Amount | Signed float — negative = expense, positive = income |
| Account Number | 6-10 digit bank account number |
| (blank) | 4th column always empty in NAB exports |
| Transaction Type | TRANSFER CREDIT, TRANSFER DEBIT, INTER-BANK CREDIT, etc. |
| Transaction Details | Free-text description (used as tx_desc) |
| Balance | Running balance |
| Category | NAB's own label (Transfers in, Transfers out, etc.) |
| Merchant Name | Usually empty |
| Processed On | Settlement date |

### Backend
- `app/parsers/nab.py` — NABParser: detects header by requiring Date, Amount, Account Number, Transaction Type, Transaction Details; parses `DD Mon YY` dates; positive amount → Income, negative → Expense
- `app/parsers/registry.py` — NABParser registered (Westpac first, NAB second)
- `tests/fixtures/nab_sample.csv` — 4-row fixture from real NAB export
- `tests/test_nab_parser.py` — 22 tests: header detection, amounts, dates, balance, dedup, upload integration

### Tests (95 passed, 5 skipped — all green)

## Chunk 6 — What Was Built (DONE)
### Backend
- `app/routers/dashboard.py` — 3 endpoints, all exclude Transfer In/Out categories
  - `GET /dashboard/summary` — total_income, total_expenses, net_savings, uncategorised_count
  - `GET /dashboard/monthly` — month-by-month rows `{ month, income, expenses, savings }`; grouped by `DATE_FORMAT(tx_date, '%Y-%m')`
  - `GET /dashboard/by-category?tx_type=Income|Expense` — `{ category_name, colour, amount }[]` sorted desc; uncategorised rows shown as "Uncategorised" bucket
- `app/main.py` — dashboard router registered

### Frontend
- `src/api/dashboard.js` — `fetchDashboardSummary`, `fetchDashboardMonthly`, `fetchDashboardByCategory`
- `src/pages/Dashboard.jsx` — full dashboard with:
  - Date range picker (default: 3 months ago → today)
  - 4 summary cards: Income · Expenses · Net Savings · Uncategorised count
  - Monthly `ComposedChart`: Income + Expenses bars + Savings line (Recharts v3)
  - 2 horizontal `BarChart`s: Spending by Category + Income by Category (top 14, coloured by category colour, amount labels)

### User decisions (Chunk 6 scoping)
- Net worth / balance tracking **postponed** — no dedicated chunk yet
- Transfers excluded from all dashboard numbers (internal movements)
- Uncategorised transactions included as "Uncategorised" bucket in category charts

### Tests (107 passed, 5 skipped — all green)
- `tests/test_dashboard.py` — 12 tests: summary totals, transfer exclusion, date filtering, monthly grouping, by-category income/expense, sort order, invalid type

## Chunk 8 — What Was Built (DONE)
### Macquarie CSV Format
| Column | Notes |
|--------|-------|
| Transaction Date | `DD Mon YYYY` (e.g. `10 Apr 2026`) — 4-digit year |
| Details | Verbose description (may include receipt numbers) |
| Account | Text account name (e.g. "Main account") — NO account number in CSV |
| Category | Macquarie's own category label |
| Subcategory | More specific Macquarie sub-category |
| Tags | User tags (usually empty) |
| Notes | User notes (usually empty) |
| Debit | Money out (expense) — positive value, empty for income |
| Credit | Money in (income) — positive value, empty for expense |
| Balance | Running balance after transaction |
| Original Description | Cleaner description — preferred over Details |

### Backend
- `app/parsers/macquarie.py` — MacquarieParser: detects header by requiring `{Transaction Date, Details, Debit, Credit, Balance, Original Description}`; parses `DD Mon YYYY` dates; Debit → Expense, Credit → Income; uses Original Description if non-empty else falls back to Details; derives account number slug from account name (e.g. "Main account" → "MAC-MAIN-ACCOUNT") since CSV has no account numbers
- `app/parsers/registry.py` — MacquarieParser registered (after NAB)
- `tests/fixtures/macquarie_sample.csv` — 108-row fixture from real Macquarie export
- `tests/test_macquarie_parser.py` — 27 tests: header detection, expense/income, dates, balance, account slug, description fallback, category concat, dedup, upload integration

### Tests (136 passed, 5 skipped — all green)

### Notes
- Macquarie does not include account numbers in CSV exports — account number is derived as a slug from the account name column; user can rename the auto-created account after first upload
- Loan accounts: user has 4 Macquarie loan accounts; loan CSV format TBD (may differ from savings)

## Chunk 9 — What Was Built (DONE)
### Home Loan Tracking — Assets, Loans, Upload Flow

### Backend
- `app/models.py` — New `Asset` model (asset_type: property/equity/stock_portfolio, address, purchase_price, current_value, is_rental, rental_income_monthly); Account extended with: asset_id FK, loan_original_amount, loan_interest_rate, loan_start_date, loan_term_years, loan_repayment_type (principal_and_interest/interest_only), offset_account_id (future)
- `app/schemas.py` — AssetCreate/Update/Response; LoanSummaryResponse (current_balance, projected_payoff_date, asset nested); LoanHistoryRow (month, payment, interest, principal, balance); Account schemas extended with all loan fields
- `app/routers/assets.py` — Full CRUD /assets; DELETE blocked 409 if linked loan accounts exist
- `app/routers/loans.py` — `GET /loans`, `GET /loans/{id}/summary` (balance via ORDER BY tx_date DESC, tx_type DESC, id ASC), `GET /loans/{id}/history` (monthly grouping)
- `app/routers/upload.py` — Added `POST /upload/detect` (parse without inserting, returns bank + accounts); added `account_id: int | None = Form(None)` to `POST /upload`
- `app/services/upload.py` — Added `account_id_override` param to `process_csv_upload()`; validates account exists; routes all transactions to that account
- `app/services/seed.py` — Added loan categories: Home Loan Interest (Expense), Home Loan Payment (Income), Loan Drawdown (Expense), Bank Fees (Expense); rules: "Interest charged"→Home Loan Interest, "Loan drawdown"→Loan Drawdown
- `app/parsers/macquarie.py` — Full rewrite: two-pass loan detection (Pass 1: classify accounts + find drawdown amounts; Pass 2: parse rows); Loan detection requires BOTH Category=Financial AND Subcategory=Interest; Unique slug for duplicate names: MAC-BASIC-HOME-LOAN-102300
- `app/parsers/base.py` — Added `account_name: str = ""` field to ParsedTransaction
- `app/main.py` — Registered assets + loans routers; startup migrations for loan columns

### Frontend
- `src/pages/Assets.jsx` — Cards per asset type (property/equity/stock_portfolio); AssetForm with conditional property fields; capital growth; delete confirmation modal
- `src/pages/Loans.jsx` — Loan cards: balance, % paid progress bar, rate, repayment type; projected payoff or "Interest Only" badge; LineChart (balance over time) + stacked BarChart (interest vs principal); summary totals; asset info panel (LVR, equity)
- `src/pages/Accounts.jsx` — Create/edit form shows loan fields when account_type=home_loan: interest rate, repayment type, loan term, original amount, linked asset dropdown; view mode shows loan badges
- `src/pages/UploadCSV.jsx` — Rewritten: three-step flow (bank → file/detect → account assignment → import); `detectCSV()` called after drop; AccountAssignment step shows dropdown per detected account (Create new or map to existing)
- `src/api/assets.js`, `src/api/loans.js` — New API client files
- `src/api/upload.js` — Added `detectCSV()` and `accountId` param to `uploadCSV()`
- `src/components/Layout/Sidebar.jsx` + `src/App.jsx` — Added Loans + Assets nav items and routes

### Macquarie Loan CSV Notes
- Loan detection: BOTH `Category="Financial"` AND `Subcategory="Interest"` required (savings accounts also have Subcategory=Interest on interest income rows)
- Duplicate account names (e.g. two "Basic Home Loan" accounts): disambiguated by drawdown amount suffix on slug
- Balance ordering: payment row has lower ID than same-day interest row → use `tx_type DESC` as tiebreaker (Income > Expense alphabetically)
- Projected payoff: uses last 92 days of Income transactions on the account (not category-filtered, because payments are rarely auto-categorised)

### Test Fixtures Added
- `tests/fixtures/macquarie_loan_sample.csv` — 6-row Boondall loan fixture
- `tests/fixtures/macquarie_dual_loan_sample.csv` — Basic Home Loan disambiguation fixture

### Tests (184 passed, 5 skipped — all green)
- `tests/test_macquarie_loan_parser.py` — 14 tests: loan detection, account_type, slug, amounts, savings false-positive protection
- `tests/test_assets.py` — 16 tests: CRUD, type validation, delete protection
- `tests/test_loans.py` — 14 tests: list, summary (balance, interest, payoff), history, asset linkage

## Chunk 4 — What Was Built (DONE)
Implemented as part of Chunk 3 inside `app/routers/transactions.py`:
- `GET /transactions` with filters: `account_id`, `tx_type` (Income/Expense), `search` (LIKE on tx_desc)
- Pagination: `page` + `per_page` (max 200), returns `total`, `pages`, `items`
- Orders by `tx_date DESC, id DESC` for deterministic results
- Frontend `Transactions.jsx` has debounced search (300ms), account dropdown, type filter tabs, page controls

## How to Run
```bash
# Services
./run.sh setup          # First time: Docker + venv + npm install
./run.sh start          # DB + tmux session (backend left | frontend right)
./run.sh status         # Check what's running (includes test DB status)
./run.sh stop           # Stop everything (dev + test DBs)

# Testing
./run.sh test           # Run backend tests (auto-starts test DB on port 3307)
./run.sh test-watch     # Auto-run tests on every .py file save
./run.sh test-db-up     # Start test database only
./run.sh test-db-down   # Stop test database
./run.sh test-db-reset  # Reset test database (drop + recreate)

# Logs
./run.sh logs           # Show recent logs from all services
./run.sh logs db        # Tail MariaDB dev logs
./run.sh logs test-db   # Tail MariaDB test logs
./run.sh logs backend   # Show/tail backend logs
./run.sh logs frontend  # Show/tail frontend logs
./run.sh logs test      # Show last test run output + debug log
```
tmux shortcuts: `Ctrl+B D` detach, `tmux attach -t finance-app` re-attach

## Chunk 10 — What Was Built (DONE)
### Superhero CSV Ingestion — Stock Trades & Holdings

### Superhero CSV Format
| Field | Notes |
|-------|-------|
| Metadata block | Entity Name, Account Name, Account Number, Report dates — above data header |
| Date format | DD/MM/YYYY |
| Amounts | `$` prefix; Buy net_amount is negative (outflow), Dividend positive |
| Dividend rows | Empty Quantity + Average Price columns |
| Settlement Date | May be empty |

### Backend
- `app/parsers/base.py` — Added `ParsedStockTrade` + `StockParseResult` dataclasses
- `app/parsers/superhero.py` — `SuperheroParser`: `can_parse(content)` scans first 30 lines for data header; two-pass parse extracts metadata then trades; strips `$` from amounts
- `app/parsers/registry.py` — `detect_stock_parser(content)` tries SuperheroParser on full content
- `app/models.py` — `StockTrade` model (SHA256 dedup on account_id|trade_date|security_code|trade_type|net_amount); `StockValuation` model (user-entered current price per security)
- `app/services/upload.py` — `process_stock_csv_upload()`: detect → parse → upsert account → insert trades
- `app/routers/upload.py` — Rewritten: tries bank parsers first, falls back to stock parsers; `/detect` endpoint returns `csv_type: "bank" | "stock"`
- `app/routers/investments.py` — Extended with: `GET /{id}/trades` (filterable, paginated); `GET /{id}/holdings` (aggregated P&L, ARR, cost basis, dividends); `GET /{id}/dividends` (monthly by security); `GET /{id}/performance` (cumulative cost basis); `PATCH /holdings/{id}/{code}/price` (update current price → re-derive P&L)
- `app/schemas.py` — `StockTradeResponse`, `HoldingRow` (full P&L + ARR), `DividendRow`, `PerformanceRow`, `HoldingPriceUpdate`
- `app/services/seed.py` — Added `Stock Purchase` (Expense) + `Dividend Income` (Income) system categories
- `tests/conftest.py` — Added `stock_valuations` + `stock_trades` to truncate_data fixture (in FK-safe order)
- `tests/fixtures/superhero_sample.csv` — 8-row fixture (PMGOLD, IVV, VTS, AAA; buys + dividends)
- `tests/test_superhero_parser.py` — 22 tests: detection, metadata, buy/dividend parsing, dollar-sign stripping, dedup, upload integration, holdings aggregation, price update

### Superhero Cash Statement (added in Chunk 10 extension)
Superhero's Cash Statement CSV tracks AUD cash account activity (deposits, FX transfers, stock purchases, dividends). Only deposits and FX transfers are imported; stock purchases and dividends are skipped (already captured in the Transaction Statement).

| Row Type | Action |
|----------|--------|
| "You deposited funds" | Imported as `Income` |
| "You transferred AUD into USD" | Imported as `Expense` |
| "You bought …" / "You ught …" (typo) | Skipped |
| "You were paid … dividend" | Skipped |
| TOTAL summary row | Skipped |

- `app/parsers/superhero_cash.py` — `SuperheroCashParser`: `can_parse(content)` scans for `{Date, Description, Debit, Credit, Balance}` headers while excluding Transaction Statement markers; account number appended with `-CASH-AUD` suffix; account_type = `"bank"`
- `app/parsers/registry.py` — `detect_cash_parser(content)` added; `get_all_platform_info()` includes "Superhero Cash" entry
- `app/services/upload.py` — `_process_parse_result()` extracted as shared helper; `process_csv_upload()` tries standard → cash parser chain
- `app/routers/upload.py` — `/detect` and `POST /upload` both try cash parser between standard bank parsers and stock parser
- `tests/fixtures/superhero_cash_sample.csv` — 8-row fixture (3 deposits, 2 buys, 1 dividend, 1 FX transfer, 1 typo buy, TOTAL)
- `tests/test_superhero_cash_parser.py` — 27 tests: `can_parse`, registry, metadata, deposits, FX transfers, skipped rows, amounts, dedup, upload integration

### Analytics Metrics
| Metric | How Derived |
|--------|-------------|
| Cost Basis | SUM(ABS(net_amount)) for Buy trades |
| Current Value | current_price × quantity_held |
| Unrealised Gain | current_value − cost_basis |
| Total Dividends | SUM(net_amount) for Dividend Received |
| Total Return % | (unrealised_gain + dividends) / cost_basis |
| ARR | `(current_value / cost_basis)^(1/years) − 1`; `⚡` badge if < 1 yr hold |
| First Buy Date | MIN(trade_date) for Buy trades |

### Frontend
- `src/api/investments.js` — Added `fetchHoldings`, `fetchTrades`, `fetchDividends`, `fetchPerformance`, `patchHoldingPrice`
- `src/pages/Investments.jsx` — Full rewrite: Superhero accounts show "Holdings" button; expands to show:
  - 3-panel charts: sector donut (cost basis), dividend timeline (stacked bar by security), cumulative cost basis line chart
  - Holdings/returns table: Code, Security, Qty, Avg Cost, Cost Basis, Current Value (inline price editor ✏️), Price Return, Dividends, Total Gain, Total Return %, ARR (⚡ badge for < 1yr), First Buy
  - Expandable trades sub-table per security (click `›` arrow)

### Tests (233 passed, 5 skipped — all green)

## Chunk 12 — Live Stock Price Refresh (DONE)

### What Was Built
- **Price fetcher**: `app/services/price_fetcher.py` — uses `yfinance` + `curl_cffi` Chrome impersonation to fetch prices from Yahoo Finance without being rate-limited on Raspberry Pi. Tries `{CODE}.AX` (ASX) first, falls back to plain `{CODE}` (US). Sequential requests with 2s delay between each.
- **Endpoint**: `POST /api/investments/{account_id}/refresh-prices` — fetches all security prices for an account, saves each as a `StockValuation` row, auto-updates `acc.current_value` from sum of holding values, returns `{ updated, failed, results, holdings, account }`.
- **Frontend**: "Refresh Prices" button in holdings table header; auto-triggers on page load; shows spinner + success/fail message; propagates updated account to card via `onAccountUpdated` callback.
- **Metrics fix**: `total_contributed` and `total_return` now derived from stock trades (not bank transfer transactions):
  - `total_contributed` = `SUM(ABS(net_amount))` for Buy trades = cost basis
  - `return_amount` = `(current_value − cost_basis) + total_dividends`
  - `return_pct` = `return_amount / cost_basis × 100`
  - Return badge now shown on Superhero account card (was hidden before)
- **RPi deployment**: Backend logs to `~/FinancePortfolioManager/logs/backend.log` via systemd `StandardOutput=append`. Service: `sudo systemctl restart financeapp-backend`.

### Key Files
- `backend/app/services/price_fetcher.py` — yfinance + curl_cffi price fetcher
- `backend/app/routers/investments.py` — refresh-prices endpoint + fixed `_build_investment_response`
- `backend/app/schemas.py` — `PriceRefreshResult`, `PriceRefreshResponse` (includes `account` field)
- `frontend/src/pages/Investments.jsx` — Refresh Prices button, auto-fetch on load, account sync
- `frontend/src/api/investments.js` — `refreshPrices(accountId)`

### Dependencies Added
- `yfinance==0.2.54` — Yahoo Finance data (already present)
- `curl_cffi==0.7.4` — Chrome TLS impersonation to bypass RPi rate limiting

### Tests (262 passed, 5 skipped — all green)
- `tests/test_price_refresh.py` — 9 tests: price fetcher unit tests (.AX suffix, fallback, None), endpoint tests (updates holdings, partial failure, 404, result shape)

## Deep Memory
Full glossary, project details, and old DB schema are in the `memory/` directory:
- `memory/glossary.md` — All acronyms, internal terms, tech stack
- `memory/projects/personal-finance-manager.md` — Full project context
- `memory/context/existing-database-schema.md` — Old v1 database schema for reference

## Chunk 11 — Open Source Release (DONE)
### What Was Done
- **Production routing fix**: Added `prefix="/api"` to all `include_router` calls in `main.py`. Removed Vite proxy `rewrite` so `/api` prefix is preserved end-to-end. Fixes 404s in production (no Vite proxy) where `/accounts` routes didn't exist at the backend level.
- **Test infrastructure**: Added `_ApiClient` wrapper class to `tests/conftest.py` — prepends `/api` to every test request so all 233 tests work via ASGI transport (no proxy). Fixed missing `options()` method needed by CORS test.
- **Fixture anonymisation fixes**: Updated integration test assertions in `test_macquarie_loan_parser.py`, `test_loans.py`, `test_nab_parser.py`, `test_superhero_cash_parser.py` to match anonymised fixture data (different account numbers, balances, amounts).
- **CORS fix**: `backend/.env` had `FRONTEND_URL=http://localhost:8000` (wrong — the backend port). Corrected to `http://localhost:5173`. Also hardcoded `http://localhost:5173` in `main.py` CORS origins so tests always pass regardless of `.env`.
- **GitHub Pages landing page**: Created `docs/index.html` — full FinHQ landing page with hero, stats, features grid, screenshot showcase, how-it-works section, privacy block. Deployed at repo GitHub Pages URL. Domain `finhq.app` earmarked for future purchase.
- **Screenshots**: 10 app screenshots renamed (removed Unicode ` ` narrow no-break space in macOS filenames) and saved to `docs/screenshots/`.
- **Git author**: Last 3 commits re-attributed to `sanhardik <sanhardik@gmail.com>` using `git cherry-pick --no-commit` + `GIT_AUTHOR_*` env vars.
- **CI / branch protection**: GitHub Actions CI runs all tests on push; branch protection requires CI to pass before merging to main.
- **Test count**: 233 passed, 5 skipped — all green.

### Key Files Changed
- `backend/app/main.py` — `/api` prefix on all routers + CORS origins fix
- `frontend/vite.config.js` — removed proxy rewrite
- `backend/tests/conftest.py` — `_ApiClient` wrapper + `options()` method
- `backend/tests/test_*.py` — fixture assertion updates (4 files)
- `docs/index.html` — GitHub Pages landing page
- `docs/screenshots/*.png` — 10 app screenshots

## Preferences
- Ask clarifying questions before giving answers
- If not sure, ask
- Show progress percentage on tasks
- Use images and visuals to explain
- Incremental chunks, test each before moving on
- Use specialised agents for tasks
- Every chunk must include working tests
- Update CLAUDE.md after each chunk

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
