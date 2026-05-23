# Contributing Guide

Thank you for your interest in contributing! This is a self-hosted personal finance manager built for Australians. Every contribution — whether it's a new bank parser, a bug fix, or better docs — is genuinely appreciated.

---

## Table of Contents

- [Quick Start](#quick-start)
- [What to Work On](#what-to-work-on)
- [Development Setup](#development-setup)
- [Branch & Commit Conventions](#branch--commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Adding a New Bank Parser](#adding-a-new-bank-parser)
- [Writing Tests](#writing-tests)
- [Code Style](#code-style)

---

## Quick Start

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/personalFinanceManager.git
cd personalFinanceManager

# 2. Create a branch
git checkout -b bank/commonwealth-bank

# 3. Make your changes, write tests, commit
git commit -m "feat(parser): add Commonwealth Bank CSV parser"

# 4. Push and open a PR
git push origin bank/commonwealth-bank
```

---

## What to Work On

Good places to start:

- **`good first issue`** — small, well-scoped tasks perfect for getting familiar with the codebase
- **`bank: new-request`** — community requests for new bank parsers (high impact, well-defined scope)
- **`help wanted`** — tasks the maintainer wants help with but can't prioritise right now

Browse open issues: [github.com/sanhardik/personalFinanceManager/issues](https://github.com/sanhardik/personalFinanceManager/issues)

If you want to work on something, **comment on the issue first** — this avoids duplicate effort and lets the maintainer give you any relevant context.

---

## Development Setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.11+ | [python.org](https://python.org) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Docker Desktop | any | Needed for the test database |

### Backend setup

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.test .env.test            # already present — no changes needed for tests
```

### Frontend setup

```bash
cd frontend
npm install
```

### Running tests

The test suite uses a dedicated MariaDB container on port 3307 (separate from dev on 3306).

```bash
# From repo root — starts test DB if not running, then runs pytest
./run.sh test

# Watch mode — re-runs on every .py save
./run.sh test-watch

# Just the test DB
./run.sh test-db-up
./run.sh test-db-down
```

### Running the full app

```bash
./run.sh start      # Starts DB + backend + frontend in a tmux session
./run.sh status     # Check what's running
./run.sh stop       # Stop everything
```

---

## Branch & Commit Conventions

### Branch names

| Prefix | Use for |
|--------|---------|
| `feature/` | New features |
| `fix/` | Bug fixes |
| `bank/` | New or updated bank parsers |
| `docs/` | Documentation only |
| `test/` | Test additions or fixes |
| `chore/` | Dependency updates, CI changes |

Examples: `bank/anz-credit-card`, `fix/westpac-date-parse`, `feature/budget-goals`

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
```

| Type | When to use |
|------|-------------|
| `feat` | New feature or parser |
| `fix` | Bug fix |
| `docs` | Documentation change |
| `test` | Adding or fixing tests |
| `refactor` | Code change with no feature/fix |
| `chore` | Build, deps, CI |

Examples:
```
feat(parser): add ANZ bank CSV parser
fix(westpac): handle credit card accounts with joint prefix
docs(contributing): add Windows setup instructions
test(nab): add edge case for empty merchant column
```

---

## Pull Request Process

1. **Open against `main`** — we don't use long-lived dev branches
2. **Fill in the PR template** — describe what changed and why
3. **All tests must pass** — CI runs pytest + lint on every PR
4. **New bank parsers require tests** — minimum 10 test cases (see below)
5. **One logical change per PR** — keep it focused; reviewers appreciate it
6. **Expect a review within 48 hours** on weekdays

The maintainer may request changes. This is normal — don't be discouraged. It's about making the code as good as possible for everyone who uses it.

---

## Adding a New Bank Parser

This is the highest-impact contribution you can make. See the full step-by-step guide:

📖 **[docs/adding-a-bank.md](docs/adding-a-bank.md)**

The short version:

1. Create `backend/app/parsers/<bankname>.py` implementing the `BankParser` ABC
2. Register it in `backend/app/parsers/registry.py`
3. Add a synthetic CSV fixture in `backend/tests/fixtures/`
4. Write at least 10 test cases in `backend/tests/test_<bankname>_parser.py`
5. Update the supported banks table in `README.md`

---

## Writing Tests

- Tests live in `backend/tests/`
- We use `pytest` with `pytest-asyncio` for async endpoints
- The test DB is a real MariaDB instance (not SQLite mocks) for production fidelity
- Use the `conftest.py` fixtures — don't create your own DB sessions
- **All tests must be green before opening a PR** — `./run.sh test`

### Test fixture CSV files

Test fixtures in `backend/tests/fixtures/` must be **completely synthetic** — no real account numbers, real transaction descriptions, or real balances. Use obviously fake data like account number `123456789`, amounts like `$42.00`, and descriptions like `GROCERY STORE`.

---

## Code Style

### Python (backend)

- Formatter: `black` (line length 100)
- Linter: `ruff`
- Type hints required on all public functions
- Docstrings on all parsers and services

Run before committing:
```bash
cd backend
ruff check .
black . --check
```

### JavaScript (frontend)

- Formatter: `prettier`
- Linter: `eslint`
- React functional components with hooks only (no class components)
- Tailwind for all styling — no inline styles

Run before committing:
```bash
cd frontend
npm run lint
```

---

## Questions?

Open a [Discussion](https://github.com/sanhardik/personalFinanceManager/discussions) in the Q&A category — happy to help you get set up.
