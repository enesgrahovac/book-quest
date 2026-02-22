#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env.local"

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
fi

STATUS_ENV="$(supabase status -o env)"

extract_status_value() {
  local key="$1"
  printf '%s\n' "$STATUS_ENV" | awk -v key="$key" '
    $0 ~ "^" key "=" {
      sub("^" key "=", "", $0)
      gsub(/^"/, "", $0)
      gsub(/"$/, "", $0)
      print $0
      exit
    }
  '
}

api_url="$(extract_status_value API_URL)"
if [ -z "$api_url" ]; then
  api_url="$(extract_status_value SUPABASE_URL)"
fi

if [ -z "$api_url" ]; then
  api_port="$(awk -F= '
    /^\[api\]/ { in_api = 1; next }
    /^\[/ { in_api = 0 }
    in_api && $1 ~ /port/ {
      value = $2
      gsub(/[[:space:]]/, "", value)
      print value
      exit
    }
  ' supabase/config.toml)"
  api_url="http://127.0.0.1:${api_port:-54321}"
fi

anon_key="$(extract_status_value ANON_KEY)"
service_key="$(extract_status_value SERVICE_ROLE_KEY)"
db_url="$(extract_status_value DB_URL)"

if [ -z "$api_url" ] || [ -z "$anon_key" ] || [ -z "$service_key" ] || [ -z "$db_url" ]; then
  echo "Could not parse Supabase local environment values." >&2
  exit 1
fi

upsert_env_var() {
  local key="$1"
  local value="$2"
  local file="$3"
  local temp_file
  temp_file="$(mktemp)"

  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$file" > "$temp_file"

  mv "$temp_file" "$file"
}

upsert_env_var "NEXT_PUBLIC_SUPABASE_URL" "$api_url" "$ENV_FILE"
upsert_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$anon_key" "$ENV_FILE"
upsert_env_var "SUPABASE_SERVICE_ROLE_KEY" "$service_key" "$ENV_FILE"
upsert_env_var "DATABASE_URL" "$db_url" "$ENV_FILE"

echo "Synced Supabase local env values into $ENV_FILE"
