# Personal Finance Manager

![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-built--in-003545?logo=sqlite&logoColor=white)
![MariaDB](https://img.shields.io/badge/MariaDB-optional-003545?logo=mariadb&logoColor=white)

A self-hosted personal finance manager for tracking bank transactions, categorising spending, and managing investment properties. Runs entirely on your own machine — no cloud, no subscriptions.

---

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/sanhardik/personalFinanceManager/main/bootstrap.py | python3
```

This downloads the app, asks where to install it, and runs the setup wizard.

> **Requirements:** Python 3.11+ must be installed before running this command.
> Download from [python.org](https://python.org) if you don't have it.

---

## Features

- **CSV import** for Westpac, NAB, and Macquarie bank statements
- **Auto-deduplication** — re-uploading the same statement is always safe (SHA-256 hash)
- **50+ default Australian spending categories** seeded on first run
- **Category hierarchy** — parent/child categories (e.g. Children → Childcare, Education)
- **Manual categorisation** with inline click-to-edit
- **Bulk categorisation** — apply a category to all similar transactions at once
- **Rules engine** — pattern-based auto-categorisation (e.g. `COLES` → Groceries)
- **Rule learning** — suggests new rules based on your manual categorisations
- **Transfer linking** — auto-matches transfers between your accounts
- **Home loan tracking** — balance, interest paid, projected payoff, payment history
- **Asset management** — link properties to loan accounts with LVR and equity tracking
- **Dashboard** — income vs. expenses charts, spending by category, savings trend

---

## Installation

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.11+ | [python.org](https://python.org) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) — needed to build the frontend |
| Docker Desktop | any | Only required if you choose the MariaDB option |

### Step 1 — Run the bootstrap

**Mac / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/sanhardik/personalFinanceManager/main/bootstrap.py | python3
```

**Windows (PowerShell):**
```powershell
python -c "import urllib.request,sys; exec(urllib.request.urlopen('https://raw.githubusercontent.com/sanhardik/personalFinanceManager/main/bootstrap.py').read())"
```

Or download [`bootstrap.py`](https://raw.githubusercontent.com/sanhardik/personalFinanceManager/main/bootstrap.py) and run:
```bash
python3 bootstrap.py
```

### Step 2 — Choose your database

The setup wizard will ask which database to use:

| Option | Best for | Requires |
|---|---|---|
| **1. SQLite** *(recommended)* | Most users — simple, no extra software | Nothing extra |
| **2. Docker + MariaDB** | Users who prefer a full database server | Docker Desktop |
| **3. External MariaDB** | Users with an existing MariaDB installation | MariaDB running locally |

### Step 3 — Wait for setup to complete

The wizard will:
1. Check prerequisites (Python, Node.js, Docker if needed)
2. Write your database configuration to `backend/.env`
3. Start MariaDB in Docker (if you chose that option)
4. Create a Python virtual environment and install packages
5. Build the React frontend
6. Confirm everything is working

You should see:
```
  [7/7] Setup complete!

  ╔══════════════════════════════════════════════════════════╗
  ║  All done! To start the app:                            ║
  ║                                                          ║
  ║    python3 start.py                                     ║
  ╚══════════════════════════════════════════════════════════╝
```

### Step 4 — Start the app

```bash
python3 start.py
```

Your browser will open automatically at **http://localhost:8000**.

---

## Daily Use

```bash
# Start the app (opens browser automatically)
python3 start.py

# Start without opening the browser
python3 start.py --no-browser

# Use a different port
python3 start.py --port 9000
```

To stop the app, press `Ctrl+C` in the terminal.

---

## Updating

```bash
git pull
python3 install.py
```

Re-running `install.py` is safe — it skips steps that are already done (existing venv, Docker DB already running).

---

## Project Structure

```
finance-app/
├── install.py              # One-time setup wizard
├── start.py                # Daily launcher
├── backend/
│   ├── app/
│   │   ├── routers/        # FastAPI route handlers
│   │   ├── services/       # Business logic (categoriser, seed, pattern extraction)
│   │   ├── parsers/        # Pluggable bank CSV parsers (Westpac, NAB, Macquarie)
│   │   ├── utils/          # Shared helpers (db_compat, etc.)
│   │   ├── models.py       # SQLAlchemy ORM models
│   │   └── schemas.py      # Pydantic request/response schemas
│   └── tests/              # pytest test suite (184+ tests)
└── frontend/
    └── src/
        ├── api/            # Axios API clients
        ├── pages/          # React page components
        └── utils/          # Shared utilities
```

---

## API Reference

The full interactive API docs are available at **http://localhost:8000/docs** once the app is running.

| Endpoint | Description |
|---|---|
| `GET /transactions` | List transactions with filters and pagination |
| `PATCH /transactions/{id}` | Manual category assignment |
| `POST /transactions/bulk-categorise` | Apply a category to multiple transactions |
| `POST /upload` | Upload a bank CSV file |
| `GET /rules` | List auto-categorisation rules |
| `POST /rules/apply` | Bulk apply all active rules |
| `GET /rules/suggestions` | Pending learned rule suggestions |
| `GET /categories` | List all categories |
| `GET /accounts` | List all accounts |
| `GET /loans` | List all home loans with metrics |
| `GET /assets` | List all tracked assets |
| `GET /dashboard/summary` | Income, expenses, savings totals |
| `GET /dashboard/monthly` | Month-by-month breakdown |

---

## Development

For contributors and developers working on the codebase:

```bash
# First-time setup
./run.sh setup

# Start all services (MariaDB + FastAPI + Vite dev server via tmux)
./run.sh start

# Run tests
./run.sh test

# Watch mode — re-runs tests on every .py save
./run.sh test-watch

# View logs
./run.sh logs
```

Service URLs in dev mode:

| Service | URL |
|---|---|
| Frontend (Vite) | http://localhost:5173 |
| API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |

---

## Troubleshooting

**"Python 3.11+ required" during bootstrap**
Download Python from [python.org](https://python.org). On Mac, `brew install python@3.13` also works.

**"Node.js not found" during setup**
Install from [nodejs.org](https://nodejs.org) (LTS version). Restart your terminal after installing.

**"Docker is not running" during setup**
Open Docker Desktop and wait for it to fully start, then run `install.py` again.

**"Virtual environment not found" when starting**
Run `python3 install.py` first. The start script requires the venv created by the installer.

**The app opens but shows a blank page**
The frontend may not be built. Run `python3 install.py` again to rebuild it.

**Port 8000 is already in use**
Use a different port: `python3 start.py --port 8080`

---

## Raspberry Pi Deployment

Running the app always-on via a Pi on your local network is a great option. These instructions assume a **Raspberry Pi 4** running Debian/Raspberry Pi OS (64-bit), with nginx serving the frontend and proxying `/api/*` to uvicorn.

### Prerequisites on the Pi

```bash
sudo apt update && sudo apt install -y mariadb-server nginx nodejs npm
```

Python 3.11+ ships with Debian 12 (bookworm) and later. Check with `python3 --version`.

### 1 — Clone and install

```bash
git clone https://github.com/sanhardik/personalFinanceManager.git ~/FinancePortfolioManager
cd ~/FinancePortfolioManager
python3 bootstrap.py   # choose "External MariaDB" and fill in credentials
```

### 2 — Create the MariaDB database

```sql
sudo mariadb
CREATE DATABASE finance_app;
CREATE USER 'finance_user'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON finance_app.* TO 'finance_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 3 — Build the frontend

```bash
cd ~/FinancePortfolioManager/frontend
npm install
npm run build
chmod -R o+rX dist   # nginx (www-data) needs read access
```

Also make the parent directory traversable by nginx:
```bash
chmod o+x /home/$(whoami)
```

### 4 — Configure nginx

Create `/etc/nginx/sites-available/financeapp`:

```nginx
server {
    listen 80;
    server_name _;   # catch-all — matches any hostname / IP

    root /home/YOUR_USER/FinancePortfolioManager/frontend/dist;
    index index.html;

    # Proxy API calls to FastAPI
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SPA fallback — send all non-asset routes to index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Replace `YOUR_USER` with your Pi username, then enable it:

```bash
sudo ln -s /etc/nginx/sites-available/financeapp /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 5 — Create a systemd service

Create `/etc/systemd/system/financeapp-backend.service`:

```ini
[Unit]
Description=Finance App FastAPI backend
After=network.target mariadb.service
Requires=mariadb.service

[Service]
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/FinancePortfolioManager/backend
EnvironmentFile=/home/YOUR_USER/FinancePortfolioManager/backend/.env
ExecStart=/home/YOUR_USER/FinancePortfolioManager/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now financeapp-backend
```

The app will now be accessible at **http://\<pi-ip-address\>** on your local network and auto-starts on boot.

### Updating the Pi

```bash
ssh user@pi-address
cd ~/FinancePortfolioManager && git pull
# If Python deps changed:
backend/venv/bin/pip install -r backend/requirements.txt
# Rebuild frontend:
cd frontend && npm run build && chmod -R o+rX dist && cd ..
sudo systemctl restart financeapp-backend
```

---

## Roadmap

- Simply Wall St (SWS) stock portfolio integration
- Investment property capital growth tracking
- Net worth over time dashboard
- Budget vs. actuals reporting
