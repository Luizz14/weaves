#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_BACKUP=""

restore_env() {
  if [ -n "$ENV_BACKUP" ] && [ -f "$ENV_BACKUP" ]; then
    mv "$ENV_BACKUP" "$ENV_FILE"
  fi
}

trap restore_env EXIT

if [ -f "$ENV_FILE" ]; then
  ENV_BACKUP="$(mktemp /tmp/superset-env.XXXXXX)"
  mv "$ENV_FILE" "$ENV_BACKUP"
fi

cd "$ROOT_DIR"

NEXT_PUBLIC_API_URL=https://api.superset.sh \
NEXT_PUBLIC_WEB_URL=https://app.superset.sh \
NEXT_PUBLIC_MARKETING_URL=https://superset.sh \
NEXT_PUBLIC_DOCS_URL=https://docs.superset.sh \
NEXT_PUBLIC_STREAMS_URL=https://streams.superset.sh \
RELAY_URL=https://relay.superset.sh \
REALTIME_URL=https://realtime.superset.sh \
bun run build --force

echo "Build criada em $ROOT_DIR/apps/desktop/release"
