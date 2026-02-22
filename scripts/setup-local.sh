#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command npm
require_command docker
require_command supabase

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop and retry." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing npm dependencies..."
  npm install
fi

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "Created .env.local from .env.example"
fi

if ! grep -q '^OPENAI_API_KEY=.\+' .env.local; then
  echo "Warning: OPENAI_API_KEY is empty in .env.local. AI features will not work yet."
fi

echo "Starting Supabase local stack..."
supabase start

bash scripts/sync-supabase-env.sh

if [ ! -f .book-quest-initialized ]; then
  echo "First-time local setup: resetting database and loading seed..."
  supabase db reset --local --yes
  touch .book-quest-initialized
else
  echo "Applying pending local migrations..."
  supabase migration up --local
fi

echo "Local setup complete."
