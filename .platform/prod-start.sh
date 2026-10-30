#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_ENV=production
exec node --env-file-if-exists=.env --import tsx server/index.ts
