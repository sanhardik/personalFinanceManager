# Personal Finance Manager

![Python](https://img.shields.io/badge/Python-3.13-blue?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![MariaDB](https://img.shields.io/badge/MariaDB-10.11-003545?logo=mariadb&logoColor=white)

A self-hosted personal finance manager for tracking bank transactions, categorising spending, and building rules for auto-categorisation. Runs locally on Mac with no external services required.

---

## Features

- **CSV import** for Westpac bank statements (NAB and Macquarie planned)
- **Auto-deduplication** via SHA-256 hash — re-uploading the same statement is always safe
- **50+ default Australian spending categories** seeded on first run (Groceries, Utilities, Childcare, Salary, and more)
- **Category hierarchy** — parent/child relationships (e.g. Children → Childcare, Education)
- **Manual transaction categorisation** with inline click-to-edit on the Transactions page
- **Bulk categorisation** — apply a category to all similar transactions in one click
- **Rules engine** — pattern-based auto-categorisation (e.g. `COLES` → Groceries, `NETFLIX` → Streaming)
- **Rule learning system** — the app observes manual categorisations and learns from them:
  - **Option A** — Inline "Create rule?" prompt appears after each manual categorisation
  - **Option B** — Pattern auto-promotes to a real rule after 3 confirmations (no action needed)
  - **Option C** — Suggested Rules review queue on the Rules page: accept or dismiss per suggestion
- **Recategorise on rule change** — updating a rule's category propagates to all matching transactions
- **API documentation** at `/docs` (Swagger UI) and `/redoc` (ReDoc)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.13, FastAPI, async SQLAlchemy, aiomysql, Pydantic v2 |
| Frontend | React 19, Vite, Tailwind CSS 4, Recharts, React Router 7 |
| Database | MariaDB 10.11 |
| Infrastructure | Docker Compose, tmux-based dev runner |

---

## Project Structure

```
finance-app/
├── backend/
│   ├── app/
│   │   ├── routers/       # FastAPI route handlers
│   │   ├── services/      # Business logic (categoriser, seed, pattern extraction)
│   │   ├── parsers/       # Pluggable bank CSV parsers
│   │   ├── models.py      # SQLAlchemy ORM models
│   │   └── schemas.py     # Pydantic request/response schemas
│   └── tests/             # pytest test suite (73+ tests)
└── frontend/
    └── src/
        ├── api/           # Axios API clients
        ├── pages/         # React page components
        └── utils/         # Shared utilities
```

---

## Getting Started

### Prerequisites

- Docker (for MariaDB)
- Python 3.13
- Node.js 18+
- tmux

### Setup

```bash
# Clone and enter the project directory
cd finance-app

# First-time setup: creates Docker containers, Python venv, and installs npm packages
./run.sh setup

# Start all services (MariaDB + FastAPI backend + React frontend)
./run.sh start
```

### Access

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| API | http://localhost:8000 |
| API Docs (Swagger) | http://localhost:8000/docs |
| API Docs (ReDoc) | http://localhost:8000/redoc |
| phpMyAdmin | http://localhost:8080 |

---

## Development Commands

```bash
./run.sh setup       # First-time setup
./run.sh start       # Start all services
./run.sh stop        # Stop all services
./run.sh status      # Check running services
./run.sh test        # Run backend tests
./run.sh test-watch  # Watch mode — re-runs tests on every .py file save
./run.sh logs        # View logs from all services
```

tmux shortcuts: `Ctrl+B D` to detach, `tmux attach -t finance-app` to re-attach.

---

## API Overview

| Endpoint | Description |
|---|---|
| `GET /transactions` | List transactions with filters and pagination |
| `PATCH /transactions/{id}` | Manual category assignment |
| `POST /transactions/bulk-categorise` | Apply a category to multiple transactions |
| `GET /rules` | List auto-categorisation rules |
| `POST /rules/apply` | Bulk apply all active rules to uncategorised transactions |
| `GET /rules/suggestions` | Pending learned rule suggestions |
| `POST /rules/suggestions/{id}/accept` | Promote a suggestion to a real rule |
| `POST /rules/suggestions/{id}/dismiss` | Dismiss a suggestion permanently |
| `POST /upload` | Upload a bank CSV file |
| `GET /categories` | List all categories |
| `GET /accounts` | List all accounts |

---

## Roadmap

- Simply Wall St (SWS) stock portfolio integration
- Investment property tracking
- NAB CSV parser with auto-detection
- Macquarie CSV parser with auto-detection
- Dashboard with charts (spending by category, net worth over time, recent transactions)
