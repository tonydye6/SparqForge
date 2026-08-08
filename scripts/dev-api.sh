#!/usr/bin/env bash
# Local API for on-machine verification.
#
# `set -a` so the .env values become real environment variables: the app does
# NOT self-load dotenv, and several clients throw at import without them.
# DATABASE_URL is overridden AFTER sourcing so the local container wins over
# whatever the file happens to hold.
set -euo pipefail
cd "$(dirname "$0")/../artifacts/api-server"

set -a
. ../../.env
set +a

export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/sparqmake_v2"
export PORT=5050
export NODE_ENV=development
export DEV_AUTH_BYPASS=true

# tsx does NOT hot-reload — restart this after every edit.
exec pnpm run dev
