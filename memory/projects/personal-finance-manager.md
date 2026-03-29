# Personal Finance Manager

**Status:** Active — Phase 1, Chunk 1 complete
**Owner:** Hardik Sanghavi
**Runtime:** Local Mac only

## What It Is
Full-stack personal finance dashboard combining bank transactions, stock portfolio (Simply Wall St), and investment property tracking into a single net worth view.

## Architecture
```
Data Sources → Cowork Agents → MariaDB → FastAPI REST → React Dashboard
```

- **Cowork agents** run on demand/schedule: ingest CSVs, categorise transactions, fetch SWS data
- **FastAPI** serves MariaDB data to React (no AI in this layer)
- **React** dashboard: charts, net worth, savings, stocks, property
- **Ad-hoc questions** asked directly in Cowork, not inside React app

## Old Code (v1)
Located in `/src/` — Flask + MariaDB (port 4406) + Docker
- Westpac CSV parser (working)
- Rule-based categorisation (pattern matching on tx description)
- Stock transaction tracking (Google Finance scraping)
- Monthly income/expense reports
- No frontend

## New Code (finance-app)
Located in `/finance-app/` — FastAPI + MariaDB (port 3306) + React
- Pluggable bank parsers (Westpac, NAB, Macquarie)
- Async SQLAlchemy + aiomysql
- React frontend with Recharts + Tailwind (light theme)
- Cowork for batch AI categorisation

## Key Decisions
1. Keep old code untouched — new folder for new code
2. MariaDB on port 3306 with new database `finance_app`
3. No Claude API spend — Cowork handles AI categorisation
4. Async backend for FastAPI compatibility
5. Light theme, clean UI
6. Build incrementally in 8 chunks, test each before moving on
7. Sample CSVs from all 3 banks needed before parser chunks

## Database — finance_app
Tables: accounts, categories, transactions, rules
- Dedup via import_hash (SHA256)
- Foreign keys: transactions → accounts, transactions → categories, rules → categories
- Seed with default Australian expense/income categories

## Phase 1 Scope
Bank CSV ingestion + transaction categorisation + basic income/expense dashboard
- 8 chunks, each with clear Definition of Done
- Full-stack vertical slices (backend + frontend per chunk)
