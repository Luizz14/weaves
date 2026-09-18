#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_BACKUP=""
APP_BUNDLE="$ROOT_DIR/apps/desktop/release/mac-arm64/Superset.app"
APPLICATIONS_APP="/Applications/Superset.app"

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

if [ ! -d "$APP_BUNDLE" ]; then
  echo "Bundle não encontrado em $APP_BUNDLE" >&2
  exit 1
fi

rm -rf "$APPLICATIONS_APP"
ditto "$APP_BUNDLE" "$APPLICATIONS_APP"

echo "Build criada e instalada em $APPLICATIONS_APP"
