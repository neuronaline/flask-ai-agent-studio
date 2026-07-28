#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
ENV_FILE="${ROOT_DIR}/.env"
ENV_EXAMPLE="${ROOT_DIR}/.env.example"
MODEL_DIR="${ROOT_DIR}/models/rag/bge-m3"

# ── helpers ─────────────────────────────────────────────────────────────────

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[34m→\033[0m %s\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }

# ── find python ─────────────────────────────────────────────────────────────

find_python() {
  for bin in python3 python; do
    if command -v "$bin" >/dev/null 2>&1; then
      echo "$(command -v "$bin")"
      return
    fi
  done
  die "python3 is required but was not found."
}

PYTHON_BIN="$(find_python)"

check_python() {
  local major minor
  major=$("$PYTHON_BIN" -c 'import sys; print(sys.version_info.major)')
  minor=$("$PYTHON_BIN" -c 'import sys; print(sys.version_info.minor)')
  if [[ "$major" -lt 3 ]] || { [[ "$major" -eq 3 ]] && [[ "$minor" -lt 9 ]]; }; then
    die "Python 3.9+ required, found $major.$minor"
  fi
}

# ── .env setup ──────────────────────────────────────────────────────────────

setup_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    if [[ -f "$ENV_EXAMPLE" ]]; then
      cp "$ENV_EXAMPLE" "$ENV_FILE"
      ok "Created .env from .env.example"
    else
      touch "$ENV_FILE"
      ok "Created empty .env"
    fi
  else
    ok ".env already exists"
  fi
}

prompt_api_keys() {
  local key

  if grep -q 'DEEPSEEK_API_KEY=your-deepseek' "$ENV_FILE" 2>/dev/null; then
    printf 'DeepSeek API key (leave blank to skip): '
    read -r key
    if [[ -n "$key" ]]; then
      sed -i "s|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=$key|" "$ENV_FILE"
    fi
  fi

  if grep -q 'OPENROUTER_API_KEY=your-openrouter' "$ENV_FILE" 2>/dev/null; then
    printf 'OpenRouter API key (leave blank to skip): '
    read -r key
    if [[ -n "$key" ]]; then
      sed -i "s|^OPENROUTER_API_KEY=.*|OPENROUTER_API_KEY=$key|" "$ENV_FILE"
    fi
  fi
}

# ── venv ────────────────────────────────────────────────────────────────────

create_venv() {
  if [[ -d "$VENV_DIR" ]]; then
    ok "Virtual environment already exists"
    return
  fi
  info "Creating virtual environment..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
  ok "Virtual environment created"
}

# ── dependencies ─────────────────────────────────────────────────────────────

install_deps() {
  local req_file="${ROOT_DIR}/requirements.txt"

  if [[ ! -f "$req_file" ]]; then
    die "requirements.txt not found at $req_file"
  fi

  info "Upgrading pip..."
  "$VENV_DIR/bin/python" -m pip install --upgrade pip --quiet

  info "Installing dependencies..."
  "$VENV_DIR/bin/python" -m pip install -r "$req_file"
  ok "Dependencies installed"
}

# ── model download ───────────────────────────────────────────────────────────

download_model() {
  if [[ -d "$MODEL_DIR" ]]; then
    info "Model already downloaded, skipping (use --model to force re-download)"
    return
  fi

  if [[ "$1" != "--model" ]]; then
    info "Skipping RAG model download (use --model to download)"
    return
  fi

  info "Downloading BGE-M3 embedding model..."
  mkdir -p "$MODEL_DIR"

  "$VENV_DIR/bin/python" -c "
from huggingface_hub import snapshot_download
snapshot_download('BAAI/bge-m3', local_dir='$MODEL_DIR', local_dir_use_symlinks=False)
print('DOWNLOAD_OK')
"
  ok "Model downloaded to $MODEL_DIR"
}

# ── main ─────────────────────────────────────────────────────────────────────

main() {
  check_python

  echo ""
  echo "  RAG Vision Chatbot — Install"
  echo "  $(date)"
  echo ""

  setup_env
  prompt_api_keys
  create_venv
  install_deps
  download_model "$@"

  echo ""
  ok "Installation complete!"
  echo ""
  printf '  Activate:   source %s/bin/activate\n' "$VENV_DIR"
  printf '  Run:        python app.py\n'
  printf '  .env:       %s\n' "$ENV_FILE"
  echo ""
}

main "$@"
