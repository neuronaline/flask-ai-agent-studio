#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/venv"

# Sanal ortam yoksa oluştur
if [ ! -d "$VENV_DIR" ]; then
    echo "Sanal ortam oluşturuluyor..."
    python3 -m venv "$VENV_DIR"
fi

# Sanal ortamı aktifleştir
source "$VENV_DIR/bin/activate"

# Gereksinimleri yükle (sadece değişiklik varsa)
if [ -f "$SCRIPT_DIR/requirements.txt" ]; then
    echo "Gereksinimler yükleniyor..."
    pip install --upgrade pip
    pip install -r "$SCRIPT_DIR/requirements.txt"
fi

# .env dosyası yoksa .env.example'dan kopyala
if [ ! -f "$SCRIPT_DIR/.env" ] && [ -f "$SCRIPT_DIR/.env.example" ]; then
    echo ".env dosyası oluşturuluyor (.env.example'dan kopyalanıyor)..."
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
fi

# Uygulamayı çalıştır
echo "Uygulama başlatılıyor..."
xvfb-run -a python core/app.py
