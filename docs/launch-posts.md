# FinHQ — Launch Posts

Ready-to-publish drafts for all 7 channels. Edit before posting — personalise where marked [PERSONALISE].

---

## 1. Show HN (Hacker News)

**Title:**
```
Show HN: FinHQ – self-hosted personal finance dashboard for Australians
```

**Body:**
```
I built FinHQ because I couldn't find a self-hosted finance app that understood Australian banks.

The problem: Australian banks (Westpac, NAB, Macquarie) all export CSVs in completely different formats — different date formats, different column layouts, different ways of representing debits and credits. Every existing self-hosted finance app I tried required manual mapping or didn't work at all.

So I built a pluggable parser system where each bank gets its own parser class that implements a common interface. Auto-detection works by inspecting the CSV header — you drop a file in and it just works.

What FinHQ does:
- Imports CSV exports from Westpac, NAB, Macquarie, and Superhero (brokerage)
- Auto-categorises transactions using a rules engine (50+ Australian merchant rules pre-seeded)
- Learns new rules from your manual categorisations — suggests patterns after you categorise the same merchant a few times
- Tracks home loans — balance, interest paid, projected payoff date
- Tracks stock portfolio via Superhero CSV exports — holdings, P&L, annualised returns
- Dashboard showing income vs. expenses, spending by category, savings trend

Tech stack: FastAPI + async SQLAlchemy on the backend, React 19 + Recharts on the frontend, SQLite (default) or MariaDB. 233 backend tests.

Everything runs locally — no accounts, no API keys, no data leaving your machine.

The bank parser architecture is the interesting bit if you want to look at the code. Each parser implements a `can_parse(header_line)` method and a `parse(content)` method that returns a standard `ParseResult`. Adding a new bank takes a few hours and there's a step-by-step contributor guide.

GitHub: https://github.com/sanhardik/finhq
```

---

## 2. r/AusFinance

**Title:**
```
I built a free, self-hosted finance dashboard for Australians — imports directly from Westpac, NAB and Macquarie CSVs
```

**Body:**
```
Hey r/AusFinance,

I've been frustrated for years that there's no good local finance tracking option that actually works with Australian banks. Apps like Mint don't support AU banks, and the ones that do (Frollo, WeMoney) require you to hand over your bank login via open banking — which I'm not comfortable with.

So I built FinHQ: a self-hosted personal finance dashboard that runs on your Mac or PC. You export a CSV from your bank's website (no login sharing required), drop it into FinHQ, and it handles the rest.

**What it does:**
- Imports Westpac, NAB, Macquarie bank and credit card CSVs
- Auto-categorises transactions (50+ Australian categories like Groceries, Fuel, Childcare, etc.)
- Dashboard showing income, expenses, net savings by month
- Tracks home loans — balance, interest paid, projected payoff
- Tracks stock portfolio via Superhero CSV exports

**What it doesn't do:**
- Send your data anywhere — it's all local
- Require open banking credentials
- Cost anything

It's completely free and open source (MIT licence). Setup takes under 5 minutes via a one-command installer.

GitHub: https://github.com/sanhardik/finhq

Happy to answer questions. What banks/features would you most want to see added?
```

---

## 3. r/selfhosted

**Title:**
```
FinHQ – open source personal finance dashboard, runs fully local (FastAPI + React + SQLite)
```

**Body:**
```
Hi r/selfhosted,

I've just open sourced FinHQ — a personal finance dashboard that runs entirely on your own machine.

**Stack:**
- Backend: Python FastAPI + async SQLAlchemy (SQLite default, MariaDB optional via Docker)
- Frontend: React 19 + Vite + Recharts + Tailwind
- No external services, no telemetry, no API calls home

**What makes it different from Firefly III / Actual Budget:**
- Built specifically for Australian banks — pluggable CSV parser system with auto-detection
- Ships with parsers for Westpac, NAB, Macquarie (bank + home loans), and Superhero (brokerage)
- Home loan tracking including balance, interest, projected payoff
- Stock portfolio tracking from CSV exports

**Docker setup** (MariaDB mode):
```
git clone https://github.com/sanhardik/finhq
cd finhq
python3 bootstrap.py
```

Or just SQLite — no Docker needed, works out of the box.

**233 backend tests**, GitHub Actions CI on every PR, full contributor guide for adding new bank parsers.

GitHub: https://github.com/sanhardik/finhq

Would love feedback on the self-hosting setup. Currently Mac/Linux focused but should work on Windows too.
```

---

## 4. r/Python + r/reactjs

**Title (r/Python):**
```
I built a pluggable bank CSV parser system in Python — now open source
```

**Body (r/Python):**
```
Just open sourced a project I've been building: FinHQ, a personal finance dashboard.

The interesting Python bit is the bank parser architecture. Australian banks all export CSVs in wildly different formats (different headers, date formats, debit/credit column layouts). I built a pluggable ABC-based system to handle this cleanly:

```python
class BankParser(ABC):
    @property
    @abstractmethod
    def bank_name(self) -> str: ...

    @abstractmethod
    def can_parse(self, header_line: str) -> bool: ...

    @abstractmethod
    def parse(self, content: str) -> ParseResult: ...
```

Auto-detection in the registry tries each registered parser's `can_parse()` against the CSV header — first match wins. Adding a new bank means implementing the ABC and adding one line to the registry.

The rest of the stack: FastAPI + async SQLAlchemy (aiomysql for MariaDB, aiosqlite for SQLite), Pydantic v2 schemas, pytest with a real MariaDB test container on port 3307.

233 tests, all passing. There's a step-by-step contributor guide for adding new parsers.

Repo: https://github.com/sanhardik/finhq

Happy to discuss the architecture or answer questions about the async SQLAlchemy setup.
```

**Title (r/reactjs):**
```
Built a personal finance dashboard with React 19 + Recharts — open source
```

**Body (r/reactjs):**
```
Just open sourced FinHQ, a self-hosted personal finance dashboard.

Frontend stack: React 19, Vite 6, Recharts v3, Tailwind 4, React Router 7, Axios.

Some things I found interesting to build:
- The charts use Recharts `ComposedChart` for the income/expenses/savings view — bars for income and expenses, line for savings trend on the same chart
- Category colours are stored in the DB and passed through to the chart `fill` prop dynamically
- The upload flow is a 3-step component (detect → assign accounts → import) with state managed locally
- Inline category editing on the transactions table with an optimistic update pattern

Repo: https://github.com/sanhardik/finhq

It's an Aussie-focused project (bank CSV imports) but the frontend is generic — happy to discuss any of the implementation choices.
```

---

## 5. Dev.to Blog Post

**Title:**
```
Building a pluggable bank CSV parser in Python — and why I open sourced it
```

**Outline / draft:**

```markdown
# Building a pluggable bank CSV parser in Python — and why I open sourced it

I wanted to track my finances in one place: bank transactions from three different banks,
a home loan, and a stock portfolio. Every existing tool either didn't support Australian banks,
required me to hand over my banking credentials, or cost money.

So I built FinHQ — and now it's open source.

## The problem with Australian bank CSVs

Every Australian bank exports CSVs differently. Westpac gives you separate Debit and Credit columns.
NAB gives you a single signed Amount column. Macquarie doesn't include account numbers in the export
at all — you have to derive them from the account name. And the date formats? All different.

```
Westpac:  Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,...
          732289824046,15/04/2026,COLES SUPERMARKETS,45.20,,1234.56,...

NAB:      Date,Amount,Account Number,,Transaction Type,Transaction Details,...
          10 Apr 26,-45.20,123456789,,VISA PURCHASE,COLES SUPERMARKETS,...

Macquarie: Transaction Date,Details,Account,Category,Subcategory,...Debit,Credit,Balance,...
           10 Apr 2026,COLES SUPERMARKETS SYDNEY,Main account,Food,...,45.20,,1234.56,...
```

## The architecture: an ABC-based pluggable parser system

[Show the BankParser ABC]

The key insight is that `can_parse()` operates on just the header line — it's fast and cheap.
The registry tries each registered parser in order; first match wins.

## Auto-detection in action

[Show the registry detect_parser() function]

## Handling edge cases

- Macquarie home loans: two-pass detection (find the drawdown amount to disambiguate duplicate account names)
- Macquarie no account numbers: derive a slug from the account name
- NAB's "blank 4th column": just ignore it in DictReader

## What I learned

- async SQLAlchemy with aiomysql has some gotchas around connection pooling in tests — use NullPool for test sessions
- SHA-256 dedup on (account_id, date, description, amount) catches re-uploads without needing a unique index per bank
- Pydantic v2's model_validator is great for cross-field validation in schemas

## The open source angle

[Explain why open sourcing it, link to CONTRIBUTING.md and adding-a-bank.md]

GitHub: https://github.com/sanhardik/finhq
```

---

## 6. LinkedIn

**Post:**
```
I've just open sourced a project I've been quietly building for the past year.

FinHQ is a self-hosted personal finance dashboard — one view for your bank accounts, spending, home loans, and stock portfolio. No cloud, no subscriptions, no sharing your banking credentials.

The problem it solves: I wanted to understand my complete financial position without logging into five different apps. And I wanted it to actually work with Australian banks.

So I built it.

Under the hood: Python FastAPI + async SQLAlchemy, React 19 + Recharts, SQLite or MariaDB. 233 backend tests. The interesting bit is a pluggable CSV parser system — each bank gets its own parser, and the right one is auto-detected from the CSV header. Adding support for a new bank is now a few hours of work with a clear guide.

It supports Westpac, NAB, Macquarie (including home loan CSV detection), and Superhero brokerage — and it's open for community contributions to add more.

If you've ever wanted a Mint/Frollo alternative that runs entirely on your own machine:

→ https://github.com/sanhardik/finhq

Happy to hear what banks or features you'd want to see. [PERSONALISE: tag any colleagues who might find this useful]
```

---

## 7. Twitter / X Thread

**Tweet 1 (hook):**
```
I open sourced FinHQ — a self-hosted personal finance dashboard that actually works with Australian banks 🇦🇺

One view for bank accounts, spending, home loans, and stocks. Your data never leaves your machine.

🧵 Here's what I built and why:
```

**Tweet 2 (the problem):**
```
The problem: Westpac, NAB, and Macquarie all export CSVs differently.

Different headers. Different date formats. Separate debit/credit columns vs single signed amount. No account numbers in Macquarie exports at all.

Every existing self-hosted finance app fell over on AU bank CSVs.
```

**Tweet 3 (the solution):**
```
So I built a pluggable parser system:

Each bank = one Python class implementing a BankParser ABC.

Auto-detection reads the CSV header → first matching parser wins.

Adding a new bank = implement 2 methods + register 1 line.
```

**Tweet 4 (features):**
```
What FinHQ does:

✅ Import CSVs from Westpac, NAB, Macquarie, Superhero
✅ Auto-categorise with a rules engine (50+ AU categories)
✅ Rules learning — suggests patterns from your behaviour
✅ Home loan tracking (balance, payoff date, interest paid)
✅ Stock portfolio P&L + annualised returns
✅ Dashboard with income/expense/savings charts
```

**Tweet 5 (tech stack):**
```
Stack:

Backend: Python FastAPI + async SQLAlchemy + SQLite (or MariaDB)
Frontend: React 19 + Vite + Recharts + Tailwind
Tests: 233 pytest tests with a real MariaDB container in CI
Deploy: runs on your Mac in 5 minutes
```

**Tweet 6 (CTA):**
```
It's MIT licensed and open for contributions — especially new bank parsers.

There's a step-by-step guide for adding any bank: just bring a sample CSV.

→ https://github.com/sanhardik/finhq

What Australian banks/features would you want to see? 👇
```

---

## Posting Schedule (suggested)

| Day | Channel | Notes |
|-----|---------|-------|
| Launch day morning | GitHub public | Do this first |
| Launch day morning | Show HN | Post between 9am–12pm US Eastern (peak HN time) |
| Launch day afternoon | r/selfhosted | Different audience — can post same day |
| Launch day afternoon | Twitter/X thread | Share after HN post goes up |
| Launch day +1 | r/AusFinance | Separate day to avoid looking spammy |
| Launch day +2 | r/Python | Technical angle |
| Launch day +3 | LinkedIn | Professional network last |
| Launch day +7 | Dev.to article | Write after you've seen initial feedback |
