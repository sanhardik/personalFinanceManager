#!/usr/bin/env python3
"""
Personal Finance Manager — Daily Launcher

Starts the server and opens your browser.

Usage:
    python3 start.py        (Mac/Linux)
    python start.py         (Windows)

Options:
    --no-browser    Start without opening the browser automatically
    --port PORT     Use a different port (default: 8000)
"""

import os
import sys
import subprocess
import platform
import time
import webbrowser
import threading
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
BACKEND_DIR = SCRIPT_DIR / "backend"
IS_WINDOWS = platform.system() == "Windows"
DEFAULT_PORT = 8000


# ── Helpers ───────────────────────────────────────────────────

def get_venv_python() -> Path:
    if IS_WINDOWS:
        return BACKEND_DIR / "venv" / "Scripts" / "python.exe"
    return BACKEND_DIR / "venv" / "bin" / "python"


def get_db_type() -> str:
    """Read DB_TYPE from backend/.env, default to 'mariadb'."""
    env_path = BACKEND_DIR / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("DB_TYPE="):
                return line.split("=", 1)[1].strip().lower()
    return "mariadb"


def check_install():
    """Exit with a helpful message if install.py hasn't been run."""
    python = get_venv_python()
    if not python.exists() or not (BACKEND_DIR / ".env").exists():
        print()
        print("  ERROR: App not set up yet.")
        print()
        print("  Run the setup wizard first:")
        print()
        if IS_WINDOWS:
            print("    python install.py")
        else:
            print("    python3 install.py")
        print()
        sys.exit(1)


# ── Docker DB management ──────────────────────────────────────

def is_docker_db_running() -> bool:
    r = subprocess.run(
        ["docker", "inspect", "--format={{.State.Running}}", "finance-db"],
        capture_output=True, text=True,
    )
    return r.stdout.strip() == "true"


def start_docker_db():
    if is_docker_db_running():
        print("  ✓  MariaDB already running")
        return

    print("  Starting MariaDB (Docker)...", end="", flush=True)
    r = subprocess.run(["docker", "compose", "version"], capture_output=True)
    compose = ["docker", "compose"] if r.returncode == 0 else ["docker-compose"]
    subprocess.run(compose + ["up", "-d", "finance-db"], cwd=SCRIPT_DIR, capture_output=True)

    for _ in range(20):
        r = subprocess.run(
            ["docker", "exec", "finance-db",
             "healthcheck.sh", "--connect", "--innodb_initialized"],
            capture_output=True,
        )
        if r.returncode == 0:
            print(" ready!")
            return
        print(".", end="", flush=True)
        time.sleep(1)
    print(" (timed out — continuing anyway)")


# ── Server ────────────────────────────────────────────────────

def start_server(port: int, open_browser: bool):
    python = get_venv_python()
    url = f"http://localhost:{port}"

    print(f"  Starting server at {url}")
    print("  Press Ctrl+C to stop")
    print()

    proc = subprocess.Popen(
        [
            str(python), "-m", "uvicorn", "app.main:app",
            "--host", "0.0.0.0",
            "--port", str(port),
        ],
        cwd=BACKEND_DIR,
    )

    if open_browser:
        def _open():
            time.sleep(2)
            webbrowser.open(url)
        threading.Thread(target=_open, daemon=True).start()

    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\n  Shutting down...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    print("  Server stopped.")


# ── Main ──────────────────────────────────────────────────────

def main():
    # Parse simple CLI flags
    args = sys.argv[1:]
    open_browser = "--no-browser" not in args
    port = DEFAULT_PORT
    if "--port" in args:
        idx = args.index("--port")
        try:
            port = int(args[idx + 1])
        except (IndexError, ValueError):
            print("  ERROR: --port requires a number (e.g. --port 8080)")
            sys.exit(1)

    print()
    print("  Personal Finance Manager")
    print()

    check_install()

    db_type = get_db_type()
    if db_type == "mariadb":
        start_docker_db()

    start_server(port, open_browser)


if __name__ == "__main__":
    main()
