#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VENV_DIR="${ROOT_DIR}/.venv"
MODEL_DIR="${ROOT_DIR}/models"
CHROMA_DIR="${ROOT_DIR}/chroma_db"
WORKSPACE_DIR="${ROOT_DIR}/data/workspaces"
ENV_FILE="${ROOT_DIR}/.env"
PROXY_FILE="${ROOT_DIR}/proxy.yaml"
INSTALL_LOG="${ROOT_DIR}/install.log"
STEPS_FILE="${ROOT_DIR}/.install_steps"

# ── helpers ─────────────────────────────────────────────────────────────────

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[34m→\033[0m %s\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }

confirm() {
  local msg="$1"
  printf '%s (yes/no): ' "$msg"
  read -r answer
  [[ "$answer" == "yes" ]]
}

# ── main ────────────────────────────────────────────────────────────────────

FULL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full) FULL=true; shift ;;
    --help|-h)
      echo "Usage: uninstall.sh [--full]"
      echo "  --full  Remove all data including workspaces and database"
      exit 0
      ;;
    *) die "Unknown option: $1" ;;
  esac
done

echo ""
echo "  RAG Vision Chatbot — Uninstall"
echo ""

# Remove venv (always)
if [[ -d "$VENV_DIR" ]]; then
  rm -rf "$VENV_DIR"
  ok "Removed .venv"
else
  info "No .venv found"
fi

# Remove models
if [[ -d "$MODEL_DIR" ]]; then
  if "$FULL" || confirm "Remove downloaded models?"; then
    rm -rf "$MODEL_DIR"
    ok "Removed models/"
  else
    info "Kept models/"
  fi
fi

# Remove ChromaDB
if [[ -d "$CHROMA_DIR" ]]; then
  if "$FULL" || confirm "Remove ChromaDB vector database?"; then
    rm -rf "$CHROMA_DIR"
    ok "Removed chroma_db/"
  else
    info "Kept chroma_db/"
  fi
fi

# Remove workspaces
if [[ -d "$WORKSPACE_DIR" ]]; then
  if "$FULL" || confirm "Remove all workspace data?"; then
    rm -rf "$WORKSPACE_DIR"
    ok "Removed data/workspaces/"
  else
    info "Kept data/workspaces/"
  fi
fi

# .env backup + remove
if [[ -f "$ENV_FILE" ]]; then
  backup="${ENV_FILE}.backup.$(date '+%Y%m%d_%H%M%S')"
  cp "$ENV_FILE" "$backup"
  ok "Backed up .env → $(basename "$backup")"
  if "$FULL" || confirm "Remove .env file?"; then
    rm -f "$ENV_FILE"
    ok "Removed .env"
  fi
fi

# Artifacts
for f in "$INSTALL_LOG" "$STEPS_FILE"; do
  if [[ -f "$f" ]]; then
    rm -f "$f"
  fi
done

ok "Uninstall complete"
