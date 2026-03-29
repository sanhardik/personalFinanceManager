# Existing Database Schema (v1)

Database: `FinanceManagement` on MariaDB port 4406

## Tables

### accounts
| Column | Type | Notes |
|--------|------|-------|
| account_id | INT PK AUTO | |
| account_number | VARCHAR(256) UNIQUE | Bank account number |
| account_name | TEXT | |

### category
| Column | Type | Notes |
|--------|------|-------|
| category_id | INT PK AUTO | |
| category_name | VARCHAR(200) | |
| category_type | VARCHAR(200) | "Income" or "Expense" |

### transactions
| Column | Type | Notes |
|--------|------|-------|
| transaction_id | INT PK AUTO | |
| account_id | INT FK→accounts | |
| category_id | INT FK→category | |
| tx_date | DATETIME | |
| tx_desc | TEXT | |
| tx_amount | FLOAT(10,2) | |
| tx_type | TEXT | "Income" or "Expense" |

### rules
| Column | Type | Notes |
|--------|------|-------|
| rule_id | INT PK AUTO | |
| rule_string | VARCHAR | Pattern to match in tx_desc |
| category_id | INT | FK to category (not enforced in DDL) |

### stock_transactions
| Column | Type | Notes |
|--------|------|-------|
| stock_id | INT PK AUTO | |
| stock_symbol | VARCHAR(50) | |
| stock_market | VARCHAR(50) | |
| stock_broker | VARCHAR(100) | |
| stock_account | VARCHAR(100) | |
| stock_name | VARCHAR(100) | |
| transaction_date | DATETIME | |
| transaction_units | FLOAT | |
| transaction_price_per_unit | FLOAT | |
| transaction_currency | VARCHAR(100) | |
| transaction_aud_price | FLOAT | |
| transaction_fee | FLOAT | |
| transaction_total | FLOAT | |
| transaction_type | VARCHAR(100) | Purchase, Sell, Dividend Cash, Dividend Stock |

## Seeding Plan
When old DB is available (docker-compose up in root), run:
```sql
SELECT * FROM FinanceManagement.category;
SELECT * FROM FinanceManagement.rules;
```
Copy into new `finance_app` database.
Until then, use hardcoded Australian defaults.
