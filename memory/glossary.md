# Glossary

Full decoder ring for the Personal Finance Manager project.

## Acronyms
| Term | Meaning | Context |
|------|---------|---------|
| PFM | Personal Finance Manager | This project |
| SWS | Simply Wall St | Stock portfolio platform, Hardik is active user |
| IRR | Internal Rate of Return | Used for stock annualised returns |
| ROI | Return on Investment | Used for property tracking |
| CRUD | Create Read Update Delete | Standard API operations |
| DoD | Definition of Done | Acceptance criteria per chunk |
| ABC | Abstract Base Class | Python pattern for bank parsers |

## Internal Terms
| Term | Meaning |
|------|---------|
| old code / v1 | Flask + MariaDB app in `/src/` directory |
| finance-app | New FastAPI + React codebase in `/finance-app/` |
| chunk | One incremental unit of work in the build plan |
| parser | Bank-specific CSV parsing class |
| dedup | Duplicate detection on CSV import via SHA256 hash |
| seed | Pre-populate database with default categories/rules |
| batch categorisation | Cowork running AI categorisation outside the app |

## Project Codenames
| Name | What |
|------|------|
| Phase 1 | Bank CSV ingestion + categorisation + dashboard |
| Phase 2 | Stocks (SWS integration), properties, advanced charts |
| Phase 3 | Open Banking API, PDF reports, budget forecasting |

## Tech Stack
| Tool | Used for |
|------|----------|
| FastAPI | Python backend (async) |
| SQLAlchemy 2.0 | ORM with async support |
| aiomysql | Async MySQL/MariaDB driver |
| MariaDB | Database (Docker, port 3306) |
| Vite | React build tool |
| Recharts | Charting library for React |
| Tailwind CSS | Utility-first CSS framework |
| Cowork | Claude desktop tool for AI tasks |
