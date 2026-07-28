#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="flask-rag-vision-chatbot"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
APP_USER="${SUDO_USER:-$USER}"
ENV_FILE="${ROOT_DIR}/.env"
VENV_DIR="${ROOT_DIR}/.venv"

# ── helpers ─────────────────────────────────────────────────────────────────

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[34m→\033[0m %s\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }

# ── checks ──────────────────────────────────────────────────────────────────

[[ "$(uname -s)" != "Linux" ]] && die "Linux only."
[[ "$EUID" -ne 0 ]] && die "Must run as root (use sudo)."
[[ -z "$APP_USER" ]] && die "Could not resolve user."
[[ ! -d "$VENV_DIR" ]] && die "Virtual env not found at $VENV_DIR. Run install.sh first."

GUNICORN_BIN="${VENV_DIR}/bin/gunicorn"
if [[ ! -x "$GUNICORN_BIN" ]]; then
  info "Installing gunicorn..."
  "${VENV_DIR}/bin/pip" install gunicorn --quiet
fi

# ── create service ───────────────────────────────────────────────────────────

info "Stopping existing service (if any)..."
systemctl disable --now "$SERVICE_NAME.service" 2>/dev/null || true

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Flask RAG Vision Chatbot
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${ROOT_DIR}
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=-${ENV_FILE}
ExecStart=${GUNICORN_BIN} --bind 0.0.0.0:5000 --workers 1 --timeout 120 app:app
Restart=always
RestartSec=5
KillSignal=SIGINT
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

chmod 644 "$SERVICE_FILE"

info "Enabling and starting service..."
systemctl daemon-reload
systemctl enable "$SERVICE_NAME.service"
systemctl restart "$SERVICE_NAME.service"

ok "Service installed: $SERVICE_NAME.service"
systemctl --no-pager --full status "$SERVICE_NAME.service" || true
