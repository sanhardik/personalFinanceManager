#!/bin/bash
#
# Personal Finance Manager — Startup Script
#
# Usage:
#   ./run.sh setup          First-time setup (Docker + venv + npm install)
#   ./run.sh db             Start MariaDB + phpMyAdmin only
#   ./run.sh backend        Start FastAPI backend (foreground — run in its own terminal)
#   ./run.sh frontend       Start React frontend (foreground — run in its own terminal)
#   ./run.sh start          Start all services (Docker + tmux: backend | frontend)
#   ./run.sh stop           Stop all services
#   ./run.sh status         Check what's running
#   ./run.sh test           Run backend tests (auto-starts test DB if needed)
#   ./run.sh test-watch     Auto-run tests on every file save
#   ./run.sh test-db-up     Start test database (MariaDB on port 3307)
#   ./run.sh test-db-down   Stop test database
#   ./run.sh test-db-reset  Reset test database (drop + recreate)
#   ./run.sh logs           Show recent logs from all services
#   ./run.sh logs db|backend|frontend|test-db
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/venv"
LOG_DIR="$SCRIPT_DIR/logs"
# tmux session for ./run.sh start (backend left pane, frontend right pane)
TMUX_SESSION="finance-app"

# Colours
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║   Personal Finance Manager               ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
    echo ""
}

# Helper: use 'docker compose' (v2) or 'docker-compose' (v1)
docker_compose() {
    if docker compose version &> /dev/null 2>&1; then
        docker compose "$@"
    else
        docker-compose "$@"
    fi
}

# Helper: docker compose for test environment
docker_compose_test() {
    if docker compose version &> /dev/null 2>&1; then
        docker compose -f docker-compose.test.yml -p finance-test "$@"
    else
        docker-compose -f docker-compose.test.yml -p finance-test "$@"
    fi
}

# Ensure logs directory exists
ensure_log_dir() {
    mkdir -p "$LOG_DIR"
}

check_prereqs() {
    local missing=0

    if ! command -v docker &> /dev/null; then
        echo -e "${RED}✗ Docker not found${NC} — install from https://docker.com"
        missing=1
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        echo -e "${RED}✗ Docker Compose not found${NC}"
        missing=1
    fi

    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}✗ Python 3 not found${NC}"
        missing=1
    fi

    if ! command -v node &> /dev/null; then
        echo -e "${RED}✗ Node.js not found${NC} — install from https://nodejs.org"
        missing=1
    fi

    if [ $missing -eq 1 ]; then
        echo -e "${RED}Please install missing prerequisites and try again.${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ All prerequisites found${NC}"
}

# ============================================================
# SETUP — First-time install
# ============================================================
setup() {
    print_header
    echo -e "${YELLOW}Running first-time setup...${NC}"
    echo ""

    echo -e "${BLUE}[1/4] Checking prerequisites...${NC}"
    check_prereqs

    echo -e "${BLUE}[2/4] Starting MariaDB + phpMyAdmin...${NC}"
    cd "$SCRIPT_DIR"
    docker_compose up -d
    echo -e "${GREEN}  ✓ MariaDB on port 3306, phpMyAdmin on port 8080${NC}"

    echo -e "${BLUE}[3/4] Setting up Python backend...${NC}"
    cd "$BACKEND_DIR"
    if [ ! -d "$VENV_DIR" ]; then
        python3 -m venv "$VENV_DIR"
        echo -e "${GREEN}  ✓ Virtual environment created${NC}"
    fi
    source "$VENV_DIR/bin/activate"
    pip install -r requirements.txt -q
    echo -e "${GREEN}  ✓ Python dependencies installed${NC}"
    deactivate

    echo -e "${BLUE}[4/4] Setting up React frontend...${NC}"
    cd "$FRONTEND_DIR"
    npm install
    echo -e "${GREEN}  ✓ Node dependencies installed${NC}"

    echo ""
    echo -e "${GREEN}Setup complete!${NC}"
    echo ""
    echo "Next steps — run each in a separate terminal tab:"
    echo ""
    echo -e "  ${YELLOW}./run.sh db${NC}         Start database"
    echo -e "  ${YELLOW}./run.sh backend${NC}    Start FastAPI  (http://localhost:8000)"
    echo -e "  ${YELLOW}./run.sh frontend${NC}   Start React    (http://localhost:5173)"
    echo ""
    echo -e "Or use ${YELLOW}./run.sh start${NC} to run DB + backend + frontend in one terminal (tmux)."
}

# ============================================================
# DB — Start MariaDB + phpMyAdmin
# ============================================================
start_db() {
    echo -e "${BLUE}Starting database...${NC}"
    cd "$SCRIPT_DIR"
    docker_compose up -d

    echo -n "  Waiting for MariaDB"
    for i in {1..30}; do
        if docker exec finance-db mariadb -ufinance_user -pfinance_pass -e "SELECT 1" &> /dev/null; then
            echo ""
            echo -e "${GREEN}  ✓ MariaDB ready on port 3306${NC}"
            echo -e "${GREEN}  ✓ phpMyAdmin on http://localhost:8080${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done
    echo ""
    echo -e "${RED}  ✗ MariaDB did not start in time. Check: docker logs finance-db${NC}"
    return 1
}

# ============================================================
# BACKEND — Start FastAPI (foreground, with auto-reload)
# ============================================================
start_backend() {
    ensure_log_dir
    echo -e "${BLUE}Starting FastAPI backend...${NC}"
    cd "$BACKEND_DIR"

    if [ ! -d "$VENV_DIR" ]; then
        echo -e "${RED}  ✗ Virtual environment not found. Run ./run.sh setup first.${NC}"
        return 1
    fi

    source "$VENV_DIR/bin/activate"
    echo -e "${GREEN}  ✓ Virtual environment activated${NC}"
    echo -e "${GREEN}  → Running on http://localhost:8000${NC}"
    echo -e "${GREEN}  → Health check: http://localhost:8000/health${NC}"
    echo -e "${YELLOW}  Press Ctrl+C to stop${NC}"
    echo ""

    # Run in foreground, tee to log file so ./run.sh logs backend works
    uvicorn app.main:app --reload --port 8000 2>&1 | tee "$LOG_DIR/backend.log"
}

# ============================================================
# FRONTEND — Start Vite React dev server (foreground)
# ============================================================
start_frontend() {
    ensure_log_dir
    echo -e "${BLUE}Starting React frontend...${NC}"
    cd "$FRONTEND_DIR"

    if [ ! -d "node_modules" ]; then
        echo -e "${RED}  ✗ node_modules not found. Run ./run.sh setup first.${NC}"
        return 1
    fi

    echo -e "${GREEN}  → Running on http://localhost:5173${NC}"
    echo -e "${YELLOW}  Press Ctrl+C to stop${NC}"
    echo ""

    # Run in foreground, tee to log file so ./run.sh logs frontend works
    npx vite --host 2>&1 | tee "$LOG_DIR/frontend.log"
}

# ============================================================
# START — DB + backend + frontend in one tmux session (split panes)
# ============================================================
start() {
    print_header

    if ! command -v tmux &> /dev/null; then
        echo -e "${RED}✗ tmux not found${NC}"
        echo "  Install:  macOS:  brew install tmux"
        echo "            Ubuntu: sudo apt install tmux"
        exit 1
    fi

    # Start DB first (Docker runs in background naturally)
    start_db || exit 1

    if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
        echo -e "${YELLOW}Replacing existing tmux session '$TMUX_SESSION'...${NC}"
        tmux kill-session -t "$TMUX_SESSION"
    fi

    echo ""
    echo -e "${BLUE}Starting backend and frontend in tmux session '$TMUX_SESSION'...${NC}"

    tmux new-session -d -s "$TMUX_SESSION" -c "$SCRIPT_DIR"
    tmux send-keys -t "$TMUX_SESSION:0.0" "cd '$SCRIPT_DIR' && ./run.sh backend" C-m
    tmux split-window -h -t "$TMUX_SESSION:0" -c "$SCRIPT_DIR"
    tmux send-keys -t "$TMUX_SESSION:0.1" "./run.sh frontend" C-m
    tmux select-layout -t "$TMUX_SESSION:0" even-horizontal 2>/dev/null || true

    echo ""
    echo -e "${GREEN}All services starting!${NC}"
    echo ""
    echo "  Dashboard:   http://localhost:5173"
    echo "  API:         http://localhost:8000"
    echo "  API Health:  http://localhost:8000/health"
    echo "  phpMyAdmin:  http://localhost:8080"
    echo ""
    echo -e "${YELLOW}tmux:${NC}  ${GREEN}$TMUX_SESSION${NC} — backend (left), frontend (right)"
    echo "  Detach:      Ctrl+B then D  (keeps services running)"
    echo "  Re-attach:   tmux attach -t $TMUX_SESSION"
    echo ""

    if [ -t 1 ]; then
        tmux attach -t "$TMUX_SESSION"
    else
        echo -e "${YELLOW}Non-interactive shell — attach manually:${NC} tmux attach -t $TMUX_SESSION"
    fi
}

# ============================================================
# STOP — Stop all services
# ============================================================
stop() {
    print_header
    echo -e "${YELLOW}Stopping services...${NC}"

    # Kill tmux dev session (stops backend + frontend panes)
    if command -v tmux &> /dev/null && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
        tmux kill-session -t "$TMUX_SESSION"
        echo -e "${GREEN}  ✓ tmux session stopped (backend + frontend)${NC}"
    fi

    # Kill any uvicorn processes for this project
    pkill -f "uvicorn app.main:app" 2>/dev/null && \
        echo -e "${GREEN}  ✓ Backend stopped${NC}" || \
        echo -e "  Backend was not running"

    # Kill any vite dev server processes
    pkill -f "node.*vite" 2>/dev/null && \
        echo -e "${GREEN}  ✓ Frontend stopped${NC}" || \
        echo -e "  Frontend was not running"

    # Stop Docker (dev DB)
    cd "$SCRIPT_DIR"
    docker_compose down
    echo -e "${GREEN}  ✓ Database stopped${NC}"

    # Stop test DB if running
    if docker ps -q --filter "name=finance-db-test" | grep -q .; then
        docker_compose_test down
        echo -e "${GREEN}  ✓ Test database stopped${NC}"
    fi

    echo ""
    echo -e "${GREEN}All services stopped.${NC}"
}

# ============================================================
# STATUS — Check what's running
# ============================================================
status() {
    print_header
    echo -e "${BLUE}Service Status:${NC}"
    echo ""

    # Database
    if docker exec finance-db mariadb -ufinance_user -pfinance_pass -e "SELECT 1" &> /dev/null 2>&1; then
        echo -e "  MariaDB:      ${GREEN}● Running${NC} (port 3306)"
    else
        echo -e "  MariaDB:      ${RED}○ Stopped${NC}"
    fi

    # Test Database
    if docker exec finance-db-test mariadb -ufinance_test_user -pfinance_test_pass -e "SELECT 1" &> /dev/null 2>&1; then
        echo -e "  Test DB:      ${GREEN}● Running${NC} (port 3307)"
    else
        echo -e "  Test DB:      ${DIM}○ Stopped${NC}"
    fi

    # Backend
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        HEALTH=$(curl -s http://localhost:8000/health)
        echo -e "  FastAPI:      ${GREEN}● Running${NC} (port 8000)"
        echo "                 $HEALTH"
    else
        echo -e "  FastAPI:      ${RED}○ Stopped${NC}"
    fi

    # Frontend
    if curl -s http://localhost:5173 > /dev/null 2>&1; then
        echo -e "  React:        ${GREEN}● Running${NC} (port 5173)"
    else
        echo -e "  React:        ${RED}○ Stopped${NC}"
    fi

    # phpMyAdmin
    if curl -s http://localhost:8080 > /dev/null 2>&1; then
        echo -e "  phpMyAdmin:   ${GREEN}● Running${NC} (port 8080)"
    else
        echo -e "  phpMyAdmin:   ${RED}○ Stopped${NC}"
    fi

    echo ""
}

# ============================================================
# TEST DB — Manage the test MariaDB container
# ============================================================
test_db_up() {
    echo -e "${BLUE}Starting test database (MariaDB on port 3307)...${NC}"
    cd "$SCRIPT_DIR"
    docker_compose_test up -d

    echo -n "  Waiting for test MariaDB"
    for i in {1..30}; do
        if docker exec finance-db-test mariadb -ufinance_test_user -pfinance_test_pass -e "SELECT 1" &> /dev/null; then
            echo ""
            echo -e "${GREEN}  ✓ Test MariaDB ready on port 3307${NC}"
            echo -e "${DIM}    DB: finance_app_test | User: finance_test_user${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done
    echo ""
    echo -e "${RED}  ✗ Test MariaDB did not start in time.${NC}"
    echo "  Check: docker logs finance-db-test"
    return 1
}

test_db_down() {
    echo -e "${BLUE}Stopping test database...${NC}"
    cd "$SCRIPT_DIR"
    docker_compose_test down
    echo -e "${GREEN}  ✓ Test database stopped${NC}"
}

test_db_reset() {
    echo -e "${YELLOW}Resetting test database...${NC}"
    cd "$SCRIPT_DIR"
    docker_compose_test down -v 2>/dev/null || true
    test_db_up
}

# ============================================================
# TEST — Run backend tests against real MariaDB
# ============================================================
test_backend() {
    print_header
    ensure_log_dir

    # Auto-start test DB if not running
    if ! docker exec finance-db-test mariadb -ufinance_test_user -pfinance_test_pass -e "SELECT 1" &> /dev/null 2>&1; then
        echo -e "${YELLOW}Test database not running — starting it...${NC}"
        test_db_up || exit 1
        echo ""
    else
        echo -e "${GREEN}  ✓ Test database already running on port 3307${NC}"
    fi

    echo -e "${BLUE}Running backend tests...${NC}"
    echo ""
    cd "$BACKEND_DIR"
    source "$VENV_DIR/bin/activate"

    # Set test environment variables
    export TEST_DB_HOST=localhost
    export TEST_DB_PORT=3307
    export TEST_DB_USER=finance_test_user
    export TEST_DB_PASSWORD=finance_test_pass
    export TEST_DB_NAME=finance_app_test

    # Run with verbose output, short tracebacks, and log capture
    # Tee to log file for later review
    python -m pytest tests/ -v \
        --tb=short \
        -x \
        --log-cli-level=WARNING \
        --log-file="$LOG_DIR/test.log" \
        --log-file-level=DEBUG \
        2>&1 | tee "$LOG_DIR/test-latest.log"

    local exit_code=${PIPESTATUS[0]}

    echo ""
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}  ✓ All tests passed!${NC}"
    else
        echo -e "${RED}  ✗ Some tests failed.${NC}"
        echo -e "  Full log: ${YELLOW}$LOG_DIR/test-latest.log${NC}"
        echo -e "  Debug log: ${YELLOW}$LOG_DIR/test.log${NC}"
    fi

    deactivate
    return $exit_code
}

# ============================================================
# TEST-WATCH — Auto-run tests on every file change
# ============================================================
test_watch() {
    print_header
    ensure_log_dir

    # Auto-start test DB if not running
    if ! docker exec finance-db-test mariadb -ufinance_test_user -pfinance_test_pass -e "SELECT 1" &> /dev/null 2>&1; then
        echo -e "${YELLOW}Test database not running — starting it...${NC}"
        test_db_up || exit 1
        echo ""
    else
        echo -e "${GREEN}  ✓ Test database already running on port 3307${NC}"
    fi

    echo -e "${BLUE}Starting test watcher...${NC}"
    echo -e "${GREEN}  Tests will re-run automatically when you save any .py file${NC}"
    echo -e "${YELLOW}  Press Ctrl+C to stop${NC}"
    echo ""
    cd "$BACKEND_DIR"
    source "$VENV_DIR/bin/activate"

    # Set test environment variables
    export TEST_DB_HOST=localhost
    export TEST_DB_PORT=3307
    export TEST_DB_USER=finance_test_user
    export TEST_DB_PASSWORD=finance_test_pass
    export TEST_DB_NAME=finance_app_test

    ptw --runner "python -m pytest tests/ -v --tb=short -x --log-cli-level=WARNING" --clear
}

# ============================================================
# LOGS — Tail logs from any or all services
# ============================================================
logs() {
    local target="${1:-all}"
    ensure_log_dir

    case "$target" in
        db)
            echo -e "${BLUE}Tailing MariaDB logs (Ctrl+C to stop)...${NC}"
            docker logs -f finance-db 2>&1
            ;;
        test-db)
            echo -e "${BLUE}Tailing test MariaDB logs (Ctrl+C to stop)...${NC}"
            docker logs -f finance-db-test 2>&1
            ;;
        backend)
            echo -e "${BLUE}Backend logs:${NC}"
            if [ -f "$LOG_DIR/backend.log" ]; then
                echo -e "${DIM}--- $LOG_DIR/backend.log ---${NC}"
                tail -100 "$LOG_DIR/backend.log"
                echo ""
                echo -e "${YELLOW}Live tail (Ctrl+C to stop):${NC}"
                tail -f "$LOG_DIR/backend.log"
            elif command -v tmux &> /dev/null && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
                tmux capture-pane -t "$TMUX_SESSION:0.0" -p -S -100
            else
                echo -e "${YELLOW}  No backend logs found.${NC}"
                echo "  Start the backend with ./run.sh backend or ./run.sh start"
            fi
            ;;
        frontend)
            echo -e "${BLUE}Frontend logs:${NC}"
            if [ -f "$LOG_DIR/frontend.log" ]; then
                echo -e "${DIM}--- $LOG_DIR/frontend.log ---${NC}"
                tail -100 "$LOG_DIR/frontend.log"
                echo ""
                echo -e "${YELLOW}Live tail (Ctrl+C to stop):${NC}"
                tail -f "$LOG_DIR/frontend.log"
            elif command -v tmux &> /dev/null && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
                tmux capture-pane -t "$TMUX_SESSION:0.1" -p -S -100
            else
                echo -e "${YELLOW}  No frontend logs found.${NC}"
                echo "  Start the frontend with ./run.sh frontend or ./run.sh start"
            fi
            ;;
        test)
            echo -e "${BLUE}Latest test output:${NC}"
            if [ -f "$LOG_DIR/test-latest.log" ]; then
                cat "$LOG_DIR/test-latest.log"
            else
                echo -e "${YELLOW}  No test logs found. Run ./run.sh test first.${NC}"
            fi
            echo ""
            if [ -f "$LOG_DIR/test.log" ]; then
                echo -e "${BLUE}Debug log (last 50 lines):${NC}"
                tail -50 "$LOG_DIR/test.log"
            fi
            ;;
        all)
            echo -e "${BLUE}=== MariaDB Logs (last 20 lines) ===${NC}"
            docker logs --tail 20 finance-db 2>&1 || echo "  (not running)"
            echo ""

            if docker ps -q --filter "name=finance-db-test" | grep -q . 2>/dev/null; then
                echo -e "${BLUE}=== Test DB Logs (last 10 lines) ===${NC}"
                docker logs --tail 10 finance-db-test 2>&1
                echo ""
            fi

            if [ -f "$LOG_DIR/backend.log" ]; then
                echo -e "${BLUE}=== Backend Logs (last 30 lines) ===${NC}"
                tail -30 "$LOG_DIR/backend.log"
                echo ""
            elif command -v tmux &> /dev/null && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
                echo -e "${BLUE}=== Backend Logs (tmux, last 50 lines) ===${NC}"
                tmux capture-pane -t "$TMUX_SESSION:0.0" -p -S -50
                echo ""
            fi

            if [ -f "$LOG_DIR/frontend.log" ]; then
                echo -e "${BLUE}=== Frontend Logs (last 20 lines) ===${NC}"
                tail -20 "$LOG_DIR/frontend.log"
                echo ""
            elif command -v tmux &> /dev/null && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
                echo -e "${BLUE}=== Frontend Logs (tmux, last 50 lines) ===${NC}"
                tmux capture-pane -t "$TMUX_SESSION:0.1" -p -S -50
                echo ""
            fi

            if [ -f "$LOG_DIR/test-latest.log" ]; then
                echo -e "${BLUE}=== Last Test Run (summary) ===${NC}"
                # Show just the summary line from the last test run
                grep -E "(PASSED|FAILED|ERROR|passed|failed)" "$LOG_DIR/test-latest.log" | tail -5
                echo ""
            fi
            ;;
        *)
            echo "Usage: ./run.sh logs [db|test-db|backend|frontend|test|all]"
            ;;
    esac
}

# ============================================================
# MAIN
# ============================================================
case "${1:-}" in
    setup)          setup ;;
    db)             start_db ;;
    backend)        start_backend ;;
    frontend)       start_frontend ;;
    start)          start ;;
    stop)           stop ;;
    restart)        stop; sleep 2; start ;;
    status)         status ;;
    test)           test_backend ;;
    test-watch)     test_watch ;;
    test-db-up)     test_db_up ;;
    test-db-down)   test_db_down ;;
    test-db-reset)  test_db_reset ;;
    logs)           logs "${2:-all}" ;;
    *)
        print_header
        echo "Usage: ./run.sh <command>"
        echo ""
        echo "Services:"
        echo "  setup           First-time setup (Docker + venv + npm install)"
        echo "  db              Start database only (Docker)"
        echo "  backend         Start FastAPI backend (foreground — use its own terminal)"
        echo "  frontend        Start React frontend (foreground — use its own terminal)"
        echo "  start           Start everything (Docker + tmux: backend | frontend)"
        echo "  stop            Stop all services"
        echo "  restart         Stop then start all services"
        echo "  status          Show status of all services"
        echo ""
        echo "Testing:"
        echo "  test            Run backend tests (auto-starts test DB on port 3307)"
        echo "  test-watch      Auto-run tests on every file save (foreground)"
        echo "  test-db-up      Start test database only"
        echo "  test-db-down    Stop test database"
        echo "  test-db-reset   Reset test database (drop + recreate container)"
        echo ""
        echo "Logs:"
        echo "  logs            Show recent logs from all services"
        echo "  logs db         Tail MariaDB logs"
        echo "  logs test-db    Tail test MariaDB logs"
        echo "  logs backend    Show/tail backend logs"
        echo "  logs frontend   Show/tail frontend logs"
        echo "  logs test       Show last test run output + debug log"
        echo ""
        echo "Quick start:"
        echo "  ./run.sh start                    # DB + tmux (backend | frontend)"
        echo "  ./run.sh test                     # Runs all tests (starts test DB if needed)"
        echo "  Or: ./run.sh db, then backend + frontend in separate terminals"
        echo ""
        ;;
esac
