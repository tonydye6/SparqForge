#!/usr/bin/env bash
# Local web app. BASE_PATH=/ because the workspace build serves under a prefix
# and vite would otherwise mount the app somewhere the browser will not find it.
set -euo pipefail
cd "$(dirname "$0")/../artifacts/sparqmake"

# The app calls /api same-origin; vite.config.ts already proxies that to
# localhost:5050, so no API base URL is needed here.
export BASE_PATH=/

exec pnpm run dev
