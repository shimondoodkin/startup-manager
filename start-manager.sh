#!/usr/bin/env bash
# Linux/macOS counterpart of start-manager.bat: install, build if needed, run.
# Programs keep running in their tmux sessions after this script exits.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3777}"
URL="http://localhost:${PORT}"

echo "=== Startup Manager ==="

if ! command -v tmux >/dev/null 2>&1 && [ -z "${TMUX_PATH:-}" ]; then
    echo "*** tmux is not installed. Try: sudo apt install tmux   (or dnf/pacman/brew)" >&2
    exit 1
fi

if [ ! -f .env ]; then
    echo "No .env found - creating one from .env.example.linux."
    echo "    Set ADMIN_USERNAME/ADMIN_PASSWORD before exposing this server."
    cp .env.example.linux .env
fi

if [ ! -d node_modules ]; then
    echo "[1/3] Installing dependencies..."
    npm install
fi

if [ ! -f dist/server.js ]; then
    echo "[2/3] Building server..."
    npm run build:server
fi

if [ ! -f .next/BUILD_ID ]; then
    echo "[2/3] Building web UI..."
    npm run build
fi

echo "[3/3] Starting server..."
echo
echo "  Open ${URL}  (login from .env)"
echo "  Ctrl+C to stop the manager. tmux sessions keep running."
echo

# Open the browser once the server answers, without blocking the server itself.
if command -v xdg-open >/dev/null 2>&1 || command -v open >/dev/null 2>&1; then
    (
        for _ in $(seq 1 60); do
            if (exec 3<>"/dev/tcp/localhost/${PORT}") 2>/dev/null; then
                exec 3>&- 3<&-
                (xdg-open "${URL}" || open "${URL}") >/dev/null 2>&1 || true
                exit 0
            fi
            sleep 1
        done
    ) &
fi

export NODE_ENV=production
exec node dist/server.js
