# Security Policy

## Overview

This is a **local-only, single-user application**. It runs entirely on your own machine and has no cloud backend, no remote API calls, and no user accounts. Your financial data never leaves your computer.

That said, security still matters — particularly around how credentials are stored and how the app is exposed on your local network.

---

## Supported Versions

We actively maintain the latest release on the `main` branch. Security fixes are applied to `main` immediately.

| Version | Supported |
|---------|-----------|
| Latest (`main`) | ✅ Yes |
| Older tagged releases | ❌ Please update to latest |

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities via public GitHub Issues.**

If you discover a security issue, report it privately by emailing:

**hardik.sanghavi@permaconn.com**

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional but appreciated)

You can expect an acknowledgement within **48 hours** and a resolution timeline within **7 days** for confirmed issues.

---

## Security Notes for Self-Hosters

### Credentials

- **Never commit your `.env` file.** It is already in `.gitignore`, but double-check before pushing.
- The `.env.example` file in the repo contains only placeholder values — it is safe to commit.
- The test environment file `backend/.env.test` contains only test database credentials with no real data — it is also safe to commit.

### Network Exposure

By default the app binds to `localhost` only:
- Backend API: `http://localhost:8000`
- Frontend: `http://localhost:5173` (dev) or served by FastAPI in production

**Do not expose port 8000 or 5173 to the public internet.** There is no authentication layer — anyone who can reach the port can read and modify your financial data.

If you need remote access, use a VPN or SSH tunnel rather than opening ports directly.

### Database

- The MariaDB container (if used) also binds to `localhost` by default.
- The default credentials in `docker-compose.yml` are for local development only. Change them if you expose the database to any network.
- SQLite mode stores the database as a plain file at `backend/data/finance.db`. Ensure appropriate file system permissions.

### Uploaded CSV Files

Bank CSV exports may contain sensitive personal and financial data. Uploaded files are processed in memory and not persisted to disk by the application. However, if you store exported CSVs on your machine, treat them like you would any sensitive financial document.

---

## Scope

The following are **in scope** for security reports:
- SQL injection or data exposure via the API
- Path traversal in file upload handling
- Local privilege escalation
- Insecure defaults that could expose the app or data

The following are **out of scope**:
- Vulnerabilities that require physical access to the machine
- Issues in third-party dependencies (please report these upstream)
- Rate limiting (this is a local single-user app)
