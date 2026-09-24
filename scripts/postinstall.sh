#!/bin/bash
# Prevent infinite recursion during postinstall.

if [ -n "$SUPERSET_POSTINSTALL_RUNNING" ]; then
  exit 0
fi

export SUPERSET_POSTINSTALL_RUNNING=1

# Run sherif for workspace validation
sherif

# Materialize the compiled Lingui catalogs. They are generated, not committed,
# and turbo builds them for any task that goes through the graph — but a direct
# `bun run --filter=<pkg> typecheck` bypasses turbo, so a fresh clone would hit
# "Cannot find module '../locales/en/messages'". Non-fatal: a missing
# translation must fail a real build, not an install.
if ! bun run --filter=@superset/i18n build; then
  echo "postinstall: lingui compile failed; run 'bun run check:i18n' for details" >&2
fi

# Native modules are copied into the isolated Node sidecar by the explicit
# packaging step (`bun run --cwd apps/desktop prepare:runtime`). Never rebuild
# them during a workspace install.
exit 0
