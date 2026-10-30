#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --env-file-if-exists=.env --import tsx --watch server/index.ts &
backend=$!
trap 'kill "$backend" 2>/dev/null || true' EXIT
pnpm dev:web
